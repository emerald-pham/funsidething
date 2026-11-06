import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  test, refuseNextRecoveryTransaction255, closeLegacyApp173, __dirname, html, sceneTimeline, flush,
  loadApp, settle, fixtureDeadline, SYNC_STORE_KEY, HOUR, syncTask, syncState, STALE_CHAIN, staleState,
  cloudState, makeSyncHarness, syncSettle, PAST_DEBOUNCE, titlesOf, CAPTURED_UNREADABLE_GENERATION,
  CAPTURED_RESULT_BUDGET_MS, largeSerializedBytes2198, CAPTURED_PHONE_SERIALIZATION_BYTES,
  capturedGenerationAcceptedApp2198, RECORDED_HEALTHY_STATUS_8CD524A, RECORDED_HEALTHY_READS_8CD524A,
  faithfulModalQuery2194, declineButton2194, pendingAutomaticDefault2194, coldRelaunch2198,
  syncStatus2200, pedestrianReservationPolicy, pedestrianDaytimeSpawnPolicy,
  assertPedestrianReservationBound, paintedMotionWorldXs,
} from "./shared.js";

test('RISK carrying isolation: immutable accepted renderer commands stay exact outside requested walker pace and kite fabric changes',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE');
 const bytes=fs.readFileSync(path.join(__dirname,'scripts/fixtures/gait-carrying-sentinel.json')),fixture=JSON.parse(bytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'740faa80ea8862bf7d1d65f4d9c3090bff6169d241b00acd3f7f2c142a06223d','preserve every original accepted input, reference hash and control');
 assert.equal(fixture.source,'19643f4369dacc74abe5a417d4c8898561d4f2f1');
 const baseline=readMotionBuild(__dirname,fixture.source);
 assert.equal(baseline.sourcesHash,'399c351a9b4550670bf2dafb2cf64bad2b155efe7a6b79c5a2dc60543f98e84e','frozen accepted renderer sources cannot be regenerated from the candidate');
 // libm/V8 architecture differences can change a final decimal in a saved
 // macOS hash. Compare both immutable builds on this same runtime, with exact
 // command equality and no numeric tolerance; retain the original fixture.
 const compare=(expected,frame,options,width)=>{
  if(['walker','dogwalker'].includes(options.actor)){
   // The user explicitly changed these routes' pace and terminal opacity. Keep
   // the frozen old bytes; compare their exact old geometry's halved travel,
   // while the connected-leg/leash/contact regressions protect the new paint.
   const anchor=width*(.18+(options.lane??.5)*.64);
   assert.ok(Math.abs(frame.metadata.x-(anchor+(expected.metadata.x-anchor)*.5))<1e-7,'requested half pace retains the same deterministic local route');
   assert.equal(frame.metadata.duration,expected.metadata.duration);assert.equal(frame.metadata.direction,expected.metadata.direction);
   assert.equal(frame.commands.find(c=>c[0]==='set'&&c[1]==='globalAlpha')[2],1,'requested walker no longer fades while visible');
  }else if(options.actor==='kite'){
   // The user requested two-tone kite fabric. Project only that explicit
   // seven-command panel onto the immutable old paint; every other command,
   // including the person, string, tail, spar and movement, remains exact.
   const commands=expected.commands,start=commands.findIndex((command,i)=>command[0]==='beginPath'&&JSON.stringify(commands[i+1])===JSON.stringify(['moveTo',0,-12])&&JSON.stringify(commands[i+2])===JSON.stringify(['lineTo',8,0]));
   assert.ok(start>=0,'immutable reference retains the original kite diamond');
   const fabric=commands[start+6][2],accent=commands[start+11][2];
   assert.deepEqual(commands.slice(start,start+14),[['beginPath'],['moveTo',0,-12],['lineTo',8,0],['lineTo',0,10],['lineTo',-8,0],['closePath'],['set','fillStyle',fabric],['fill'],['beginPath'],['moveTo',0,-12],['lineTo',0,10],['set','strokeStyle',accent],['set','lineWidth',1],['stroke']]);
   const panel=[['beginPath'],['moveTo',0,-12],['lineTo',8,0],['lineTo',0,10],['closePath'],['set','fillStyle',accent],['fill']];
   const projected={...expected,commands:[...commands.slice(0,start+8),...panel,...commands.slice(start+8)]};
   assert.deepEqual(frame,projected,'only the explicitly requested seeded fabric panel changes immutable kite paint');
  }else assert.deepEqual(frame,expected,'unaffected carrying/activity consumer retains exact196 painter output');
 };
 for(const c of fixture.controls){const expected=createMotionProbe(baseline,c).sample(c.options),frame=createMotionProbe(build,c).sample(c.options);compare(expected,frame,c.options,c.width);assert.deepEqual(frame,createMotionProbe(build,c).sample(c.options),'cold reconstruction matches actual candidate painter');}
 for(const sequence of fixture.walkingSequences){const expected=createMotionProbe(baseline,sequence),probe=createMotionProbe(build,sequence);for(const c of sequence.frames)compare(expected.sample(c.options),probe.sample(c.options),c.options,sequence.width);}
 const control=fixture.controls[0],expected=createMotionProbe(baseline,control).sample(control.options),broken=JSON.parse(JSON.stringify(expected));broken.commands.push(['moveTo',1e-12,0]);
 assert.throws(()=>assert.deepEqual(broken,expected),'negative control: even a tiny extra renderer command fails exact comparison');
});
test('RISK carrying locomotion: actual fast departure painters avoid aliased walking cadence and preserve every limb and grip',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE');
 for(const [width,height] of [[390,844],[1440,900]])for(const reverse of [false,true])for(const actor of ['reader','couple','picnic','kite','snowman','snowangel']){
  let current=[],previous=[],contacts=0,observed=0;
  const probe=createMotionProbe(build,{width,height,onHumanPose:(pose,args)=>current.push({pose,args})});
  for(let frame=0;frame<=150;frame++){
   current=[];probe.sample({actor,progress:.885+frame/30/100,duration:100,seed:.4,lane:.02,reverse});
   current.forEach(({pose,args},person)=>{
    observed++;
    pose.legs.forEach((leg,index)=>{
     const prior=previous[person]?.legs[index];if(prior&&prior.lift>0&&leg.lift===0)contacts++;
     assert.ok(Math.abs(Math.hypot(leg.kneeX-pose.hipX,leg.kneeY-pose.hipY)-3.2)<1e-7,'fast travel preserves thigh length');
     assert.ok(Math.abs(Math.hypot(leg.footX-leg.kneeX,leg.footY-leg.kneeY)-3.2)<1e-7,'fast travel preserves shin length');
    });
    if(actor==='reader'||actor==='couple'||actor==='picnic'){
     assert.equal(args[5],1,'departure actual painter keeps its carrying grip');
     assert.ok(Math.abs(pose.hand.x-pose.hipX-4)<1e-8);
     assert.ok(Math.abs(pose.hand.y-pose.bob+3)<1e-8);
    }
   });
   previous=current.map(record=>record.pose);
  }
  assert.ok(observed>0,'each actual standing departure painter must be observed');
  const people=['couple','picnic'].includes(actor)?2:1;
  assert.ok(contacts/people<=18,`${actor} ${width} reverse=${reverse}: ${contacts/people} contact changes in five seconds must not repeat the observed flickering walking pose at running speed`);
 }
});
test('RISK human support balance: rejected steep phone walks keep the vertical torso over a usable planted support',()=>{
 const ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);
 const geo=ctx.LandscapeGeometry.create(390,844);
 // The independent browser rejection traversed this exact lane, seed and raw
 // age interval. Knee-angle/terrain-clearance passes previously hid a pelvis
 // projected downhill beyond both toes beneath an otherwise vertical torso.
 for(const type of ['walker','dogwalker'])for(const reverse of [false,true])for(let frame=0;frame<=180;frame++){
  const e={type,age:(.45+frame/180*.08)*70,duration:70,seed:.4,lane:.02,reverse},pose=geo.groundPose('walker',e),direction=reverse?-1:1,ground=x=>geo.groundAnchor('walker',x);
  const motion=geo.humanWalkPose(pose.x,pose.y,pose.distance,direction,ground,false,1,pose.travel),contacts=motion.legs.filter(leg=>leg.lift===0);
  if(motion.locomotion==='walk')assert.ok(contacts.length>0,'a walking frame always retains a planted support');
  if(!contacts.length)continue;
  const lateralSupport=Math.min(...contacts.map(leg=>Math.abs(leg.footX-motion.hipX)));
  assert.ok(lateralSupport<=2.5,`${type} reverse=${reverse}, frame=${frame}, x=${pose.x}: vertical torso is ${lateralSupport.toFixed(3)} units away from its nearest planted support; raised hips must not make a sitting silhouette`);
  for(const leg of contacts){const nextDistance=pose.distance+1e-5,nextX=pose.x+direction*1e-5,next=geo.humanWalkPose(nextX,ground(nextX),nextDistance,direction,ground,false,1,pose.travel),other=next.legs[motion.legs.indexOf(leg)];if(other.lift===0)assert.ok(Math.abs(pose.x+direction*leg.footX-nextX-direction*other.footX)<1e-8,'balance repair must retain real world foot planting');}
 }
});

test('RISK human terrain cadence: local contact spacing preserves world planting and deterministic arrivals',()=>{
 const ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);
 for(const [width,height] of [[390,844],[844,390],[820,1180],[1440,900]])for(const direction of [-1,1]){
  const geo=ctx.LandscapeGeometry.create(width,height);
  for(const name of ['middle','near','trail']){
   const ground=geo.humanGround(name);
   for(let index=0;index<=80;index++){
    const distance=width*index/80,x=direction===1?distance:width-distance,p=geo.humanWalkPose(x,ground(x),distance,direction,ground,.5);
    const step=1e-5,nextX=x+direction*step,next=geo.humanWalkPose(nextX,ground(nextX),distance+step,direction,ground,.5);
    for(let leg=0;leg<2;leg++)if(p.legs[leg].lift===0&&next.legs[leg].lift===0)assert.ok(Math.abs(x+direction*p.legs[leg].footX-nextX-direction*next.legs[leg].footX)<1e-8,'local stride adaptation cannot slide a planted world foot');
    assert.deepEqual(p,geo.humanWalkPose(x,ground(x),distance,direction,ground,.5),'a sought frame has no smoothing history');
   }
   const arrival=geo.humanWalkPose(width/2,ground(width/2),40,direction,ground,1);
   assert.ok(arrival.legs.every(leg=>leg.lift===0),'forty-unit visitor approach ends with both feet resting on each responsive ground');
  }
 }
});

test('RISK upright human gait: full cycles extend stance knees with modest swing flexion and preserved terrain contact',()=>{
 const ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);
 for(const [w,h] of [[390,844],[844,390],[820,1180],[1440,900]])for(const direction of [-1,1])for(const scale of [.65,1,1.2])for(const carrying of [0,.5,1]){
  const geo=ctx.LandscapeGeometry.create(w,h);
  for(const slope of [0,-.15,.15,-.9,.9,-1.4,1.4]){
   let extended=0,stance=0,centralSupports=0,completedSupports=0;const intervals=[null,null],completedByLeg=[0,0];const ground=fx=>h/2+slope*(fx-w/2),travel={kind:'constant',startDistance:0,speed:7};
   for(let frame=0;frame<120;frame++){
    const distance=frame/120*14*scale,x=w/2+direction*distance,y=ground(x);
    const p=geo.humanWalkPose(x,y,distance,direction,ground,carrying,scale,travel);
    if(Math.abs(slope)<.2)assert.ok(p.hipY < -5.3,'pelvis must stay upright rather than shorten the six-unit legs to a crouch');
    assert.ok((ground(x+direction*scale*(p.hipX||0))-y)/scale-p.hipY>5.3,'terrain beneath the pelvis must leave upright clearance');
    assert.ok(!(p.legs.every(leg=>leg.lift===0)&&p.legs.every(leg=>2*Math.acos(Math.min(1,Math.hypot(leg.footX-p.hipX,leg.footY-p.hipY)/6.4))*180/Math.PI>60)),'grounded double support cannot collapse both knees into a crouch');
    for(const [legIndex,leg] of p.legs.entries()){
     const reach=Math.hypot(leg.footX-(p.hipX||0),leg.footY-p.hipY),flex=2*Math.acos(Math.min(1,reach/6.4))*180/Math.PI;
     assert.ok(reach<=6.4+1e-8,'leg endpoints must remain physically reachable');
     assert.ok(Math.abs(Math.hypot(leg.footX-leg.kneeX,leg.footY-leg.kneeY)-3.2)<1e-7,'shin length remains fixed');
     assert.ok(flex<85,'swing knee must bend modestly rather than fold into a squat');
     if(leg.lift===0){stance++;if(flex<35)extended++;
      if(!intervals[legIndex])intervals[legIndex]={completeStart:frame>0,central:false};
      if(Math.abs(leg.footX-p.hipX)<.12){centralSupports++;intervals[legIndex].central=true;assert.ok(flex<60,'the active planted leg beneath the pelvis cannot remain deeply crouched');}
      assert.ok(Math.abs(y+scale*leg.footY-ground(x+direction*scale*leg.footX))<1e-8);
      const nextDistance=distance+1e-5,nextX=x+direction*1e-5,q=geo.humanWalkPose(nextX,ground(nextX),nextDistance,direction,ground,carrying,scale,travel),other=q.legs[p.legs.indexOf(leg)];
      if(other.lift===0)assert.ok(Math.abs(x+direction*scale*leg.footX-nextX-direction*scale*other.footX)<1e-8,'stance remains planted');
     }else if(intervals[legIndex]){
      const interval=intervals[legIndex];if(interval.completeStart){completedSupports++;completedByLeg[legIndex]++;assert.ok(interval.central,'each completed planted interval on each leg crosses beneath the pelvis');}intervals[legIndex]=null;
     }
    }
   }
   if(Math.abs(slope)<.2)assert.ok(extended/stance>.65,'most flat and gentle walking stance frames need an extended support knee');
   else assert.ok(centralSupports>0&&completedSupports>0&&completedByLeg.every(count=>count>0),'steep speed-appropriate travel must include an independently located planted central support');
  }
 }
});

test('RISK dense human contact corridor: final blended pelvis and limbs remain feasible at contact and window seams',()=>{
 const ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);
 for(const slope of [0,.1999,.2001,.9,1.4,-.9,-1.4])for(const direction of [-1,1]){
  const geo=ctx.LandscapeGeometry.create(390,844),ground=x=>422+slope*(x-195),travel={kind:'constant',startDistance:0,speed:7};let previous;
  for(let i=0;i<=14000;i++){
   const distance=i*.001,x=195+direction*distance,p=geo.humanWalkPose(x,ground(x),distance,direction,ground,1,1,travel);
   assert.ok(-p.hipY>5.3,'the final blended pelvis retains upright local clearance');
   if(previous)assert.ok(Math.abs(p.hipY-previous.hipY)<=.0007+1e-8,'overlapping clearance windows must not exceed the transfer gradient at their four-unit seams');
   for(const leg of p.legs){
    assert.ok(Math.hypot(leg.footX-p.hipX,leg.footY-p.hipY)<=6.4+1e-8,'final endpoints must fit the actual two-link leg without acos clipping');
    assert.ok(Math.abs(Math.hypot(leg.kneeX-p.hipX,leg.kneeY-p.hipY)-3.2)<1e-7);
    assert.ok(Math.abs(Math.hypot(leg.footX-leg.kneeX,leg.footY-leg.kneeY)-3.2)<1e-7);
    if(leg.lift===0)assert.ok(Math.abs(ground(x)+leg.footY-ground(x+direction*leg.footX))<1e-8,'a planted support stays on actual terrain');
   }
   previous=p;
  }
 }
});

test('RISK upright torso travel: flat-ground pelvis travels steadily while terrain adaptation stays continuous',()=>{
 const ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);const geo=ctx.LandscapeGeometry.create(390,844);
 for(let distance=0;distance<14;distance+=.025){
  const flat=geo.humanWalkPose(distance,0,distance,1,()=>0,1);
  assert.ok(Math.abs(flat.hipX)<1e-8,'flat-ground body must not stop over a planted toe and surge into the next step');
  const ground=x=>Math.sin(x/30)*30,p=geo.humanWalkPose(distance,ground(distance),distance,1,ground,1),d=distance+1e-6,q=geo.humanWalkPose(d,ground(d),d,1,ground,1);
  assert.ok(Math.hypot(p.hipX-q.hipX,p.hipY-q.hipY)<.0001,'terrain hip must remain continuous through contact changes');
 }
});

test('RISK upright pelvis consumer: torso head thighs and carrying arms follow the terrain hip',()=>{
 const source=fs.readFileSync(path.join(__dirname,'landscape.js'),'utf8'),code=source.slice(source.indexOf('  function person('),source.indexOf('  function seated('));
 const ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);
 for(const carrying of [0,.5,1])for(let distance=0;distance<14;distance+=.2){
  const motion=ctx.LandscapeGeometry.create(390,844).humanWalkPose(distance,-.9*distance,distance,1,x=>-.9*x,carrying),lines=[],heads=[];
  Object.assign(ctx,{g:{},motion,color:()=> 'shirt',skinColor:()=> 'skin',line(g,...v){lines.push(v);},personHead(g,...v){heads.push(v);}});
  vm.runInContext(code+';person(0,0,.4,motion)',ctx);
  assert.ok(lines.some(v=>v[4]==='shirt'&&v[0]===motion.hipX&&v[2]===motion.hipX&&v[3]===motion.hipY),'actual torso sits above the terrain hip');
  assert.equal(heads[0][0],motion.hipX,'head follows the torso');
  for(const leg of motion.legs)assert.ok(lines.some(v=>v[0]===motion.hipX&&v[1]===motion.hipY&&v[2]===leg.kneeX&&v[3]===leg.kneeY),'actual thighs originate at the terrain hip');
  assert.ok(lines.some(v=>v[4]==='skin'&&v[2]===motion.hand.x&&v[3]===motion.hand.y),'carrying endpoint stays at the returned grip');
 }
});

test('RISK upright gait consumer: every human painter consumes upright full cycles in both directions at responsive scales',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE');
 const ctx=vm.createContext({Math});vm.runInContext(build.sources['landscape-geometry.js'],ctx);vm.runInContext(build.sources['landscape-winter.js'],ctx);
 for(const [width,height] of [[390,844],[844,390],[820,1180],[1440,900]])for(const reverse of [false,true]){
  const geo=ctx.LandscapeGeometry.create(width,height),probe=createMotionProbe(build,{width,height});
  for(const actor of ['walker','dogwalker','reader','couple','picnic','kite','snowman','snowangel'])for(const offset of ['couple','picnic'].includes(actor)?[-11,11]:[0])for(let frame=0;frame<60;frame++){
   const progress=.9+frame/60*.06,e={type:actor,age:progress*100,duration:100,seed:.4,lane:.5,reverse};
   let pose,ground,scale=1;
   if(['walker','dogwalker'].includes(actor)){pose=geo.groundPose('walker',e);ground=geo.humanGround('trail',5);}
   else if(['snowman','snowangel'].includes(actor)){const winter=ctx.LandscapeWinter.pose(actor,e,geo,width,height);pose={x:actor==='snowman'?winter.builderX:winter.x,y:actor==='snowman'?winter.builderGroundY:winter.groundY,distance:winter.walkDistance,travel:winter.travel};scale=actor==='snowman'?winter.builderScale:winter.scale;ground=geo.humanGround(actor==='snowman'?'middle':'near',winter.snowOffset);}
   else {pose=geo.visitPose(e,progress);pose.x+=offset;ground=geo.humanGround('trail',20);pose.y=ground(pose.x);}
   const p=geo.humanWalkPose(pose.x,pose.y,pose.distance,reverse?-1:1,ground,actor==='reader'||actor==='picnic'||actor==='couple',scale,pose.travel);
   const hipClearance=(ground(pose.x+(reverse?-1:1)*scale*(p.hipX||0))-pose.y)/scale-p.hipY;
   if(pose.x>=0&&pose.x<=width)assert.ok(hipClearance>5.3,`${actor} at ${width}, frame ${frame}, x ${pose.x}, hip ${p.hipY} must retain upright terrain posture`);
   for(const leg of p.legs)assert.ok(Math.abs(Math.hypot(leg.kneeX-(p.hipX||0),leg.kneeY-p.hipY)-3.2)<1e-7,'existing thigh proportions stay fixed');
   const sample=probe.sample({actor,progress,reverse,width,height,duration:100,seed:.4,lane:.5,zoom:1});
   assert.ok(sample.commands.length>20);
   if(frame===0)assert.deepEqual(probe.sample({actor,progress:.1,reverse,reduced:true}),probe.sample({actor,progress:.9,reverse,reduced:true}),'actual reduced-motion consumer stays still');
  }
 }
});

test('RISK shared scenery: normalized clouds and bounded schedules survive midnight viewport season and reduced motion changes',()=>{
 const context=sceneTimeline(),T=context.LandscapeTimeline;
 const seed='private-boundaries',options={seed,season:'summer',sunAt:()=>({altitude:-20,azimuth:0})},timeline=T.create(options);
 for(const at of [Date.parse('2026-10-05T23:59:59.999Z'),Date.parse('2026-10-06T00:00:00Z'),Date.parse('2026-11-01T05:59:59Z'),Date.parse('2026-11-01T06:00:00Z')]){
  const scene=timeline.at(at),fresh=T.create(options).at(at);
  assert.deepEqual(JSON.parse(JSON.stringify(scene)),JSON.parse(JSON.stringify(fresh)),'midnight and DST do not depend on an earlier page');
  assert.ok(scene.events.filter(e=>e.age<(e.activityDuration||e.duration)).length<=context.LivingSky.MAX_EVENTS&&scene.woodland.length<=4,'existing admission budgets remain bounded');
  assert.ok(scene.events.length<=context.LivingSky.MAX_EVENTS+Math.ceil((900+8392/1.4)/8),'extended visual tails retain a finite immutable proposal bound');
  assert.ok(scene.events.every(e=>e.age>=0&&e.age<e.duration&&e.duration>0&&(e.activityDuration||e.duration)<=300&&e.duration<=900+8392/1.4&&Number.isFinite(e.seed)));
  for(const [width,height] of [[320,568],[390,844],[568,320],[768,1024],[1440,900]])for(const reduced of [false,true]){
   const other=T.create({...options,width,height,reduced}).at(at);
   assert.deepEqual(JSON.parse(JSON.stringify(other)),JSON.parse(JSON.stringify(scene)),'viewport and motion preference cannot select different logical objects');
  }
  assert.equal(scene.clouds.length,7);
  assert.ok(scene.clouds.every(c=>[c.x,c.y,c.size,c.opacity].every(Number.isFinite)&&c.x>=-.2&&c.x<=1.2));
 }
 const before=timeline.at(Date.parse('2026-10-05T23:59:59Z')),after=timeline.at(Date.parse('2026-10-06T00:00:01Z'));
 for(const event of before.events)if(event.age+2<event.duration){
  const retained=after.events.find(e=>e.id===event.id);assert.ok(retained,'midnight does not replace a still-active visitor');
  assert.ok(Math.abs(retained.age-event.age-2)<1e-7);
 }
 assert.equal(T.create({...options,season:'winter'}).at(Date.parse('2026-10-06T03:00Z')).events.some(e=>['picnic','butterfly','jetski','windsurfer'].includes(e.type)),false);
 assert.equal(T.create({...options,sunAt:()=>({altitude:40,azimuth:100})}).at(Date.parse('2026-10-06T03:00Z')).party,null);
 assert.throws(()=>timeline.at(NaN),/instant/i);
});

test('RISK shared scenery lights: one-minute independent roof samples remain stable between opportunities in normalized space',()=>{
 const context=sceneTimeline(),timeline=context.LandscapeTimeline.create({seed:'private-light-fixture',sunAt:()=>({altitude:-20,azimuth:0})});
 let now=Date.parse('2026-10-06T03:00Z'),previous=timeline.at(now).gardens;const samples=new Map(Object.keys(previous).map(index=>[index,{on:0,total:0}]));
 for(let i=0;i<1500;i++){
  const a=timeline.at(now),b=timeline.at(now+59999);
  assert.deepEqual({...a.gardens},{...b.gardens},'frames and motion do not reroll a roof');
  assert.ok(Object.keys(a.gardens).filter(index=>a.gardens[index]!==previous[index]).length<=1,'one normalized roof at most can change at each opportunity');
  for(const index of Object.keys(a.gardens)){const count=samples.get(index);count.total++;count.on+=Number(a.gardens[index]);}
  previous=a.gardens;now+=60000;
 }
 for(const {on,total} of samples.values())assert.ok(on/total>.02&&on/total<1/3,'independent one-in-six samples remain sparse rather than all-on or a fifty-percent toggle');
});

for(const type of ['fireworks','festival'])test(`RISK fireworks twilight: UTC ${type} opportunities admit both twilight directions and reload exactly`,()=>{
 const context=sceneTimeline(),original=context.LandscapeConfig;
 // Isolate the two show actors so unrelated daytime traffic cannot consume admission capacity.
 context.LandscapeConfig={...original,spawnRate:actor=>['fireworks','festival'].includes(actor)?original.spawnRate(actor):0};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-timeline.js'),'utf8'),context);
 const options={seed:'private-phase-boundaries',season:'summer'},T=context.LandscapeTimeline,night=T.create({...options,sunAt:()=>({altitude:-20,azimuth:90})});
 let instant;
 for(let minute=0;minute<1440&&instant===undefined;minute++)if(night.at(minute*60000+1000).events.some(e=>e.type===type))instant=minute*60000+1000;
 assert.notEqual(instant,undefined,'the fixed UTC fixture contains this show source');
 for(const azimuth of [90,270])for(const altitude of [-6,0,4,7.999,8,20]){
  const fixed={...options,sunAt:()=>({altitude,azimuth})},a=T.create(fixed).at(instant),b=T.create(fixed).at(instant);
  assert.equal(a.events.some(e=>e.type===type),altitude<8,`${type} UTC admission at ${altitude}, azimuth ${azimuth}`);
  assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),'reload rebuilds the exact same UTC scene');
 }
});

test('RISK continuous daylight consumers: the real timeline and show painters suppress the 65.8 N boundary',()=>{
 const scenery=sceneTimeline(),sampler=scenery.LivingSky,location={latitude:65.8,longitude:18.96,timezone:'Europe/Oslo'},date=new Date('2026-06-21T00:28:09.928Z'),sky=sampler.skyAt(date,location),start=Date.parse('2026-06-20T22:00:00Z');
 const timeline=scenery.LandscapeTimeline.create({seed:scenery.LandscapeTimeline.DEFAULT_SEED,season:'summer',location}),scheduled=new Map();
 for(let minute=0;minute<1440;minute++){const at=start+minute*60000;for(const event of timeline.at(at).events)if(['fireworks','festival'].includes(event.type))scheduled.set(event.id,{type:event.type,start:at/1000-event.age});}
 const shows=[...scheduled.values()].sort((a,b)=>a.start-b.start).map(event=>`${event.type}@${new Date(event.start*1000).toISOString()}`);
 const source=fs.readFileSync(path.join(__dirname,'landscape.js'),'utf8'),from=source.indexOf('  function paintFestivalBarge(e){'),to=source.indexOf('\n  function paintClocktowerVisit()',from),paint=source.slice(from,to),paintCalls=[],paintCounts={},recorder={group:''};
 assert.ok(from>=0&&to>from,'the real barge, stage, and firework painters are available');
 const target={globalAlpha:1,globalCompositeOperation:'source-over',createLinearGradient(){return {addColorStop(){}};}},g=new Proxy(target,{get(object,key){return key in object?object[key]:(...args)=>{paintCalls.push(recorder.group);};},set(object,key,value){object[key]=value;return true;}});
 const festival={type:'festival',age:75,duration:150,lane:.55,seed:.4},fireworks={type:'fireworks',age:1.6,duration:60,lane:.55,seed:.4},painterContext={Date,Math,S:sampler,sky,festival,fireworks,recorder,world:{events:[]},g,geometry:scenery.LandscapeGeometry.create(390,844),W:390,H:844,far:[],cityLayer:{width:390,height:844},dpr:1,p:{sky:['#111111','#222222','#333333']},path(){},line(){paintCalls.push(recorder.group);},ellipse(){paintCalls.push(recorder.group);},reflectWaterObject(_y,draw){draw();},scenePose:event=>event};
 vm.createContext(painterContext);vm.runInContext(`${paint};recorder.group='festival barge';paintFestivalBarge(festival);recorder.group='festival stage';paintFestival(festival);recorder.group='standalone shells';world.events=[fireworks];paintFireworks('fireworks');recorder.group='festival shells';world.events=[festival];paintFireworks('festival')`,painterContext);
 for(const group of paintCalls)paintCounts[group]=(paintCounts[group]||0)+1;
 const failures=[];
 if(!sky.polarDay||sky.period!=='day')failures.push(`solar=${JSON.stringify({polarDay:sky.polarDay,period:sky.period,altitude:sky.sun.altitude})}`);
 if(shows.length)failures.push(`timeline=${JSON.stringify(shows)}`);
 if(paintCalls.length)failures.push(`painters=${JSON.stringify(paintCounts)}`);
 assert.deepEqual(failures,[],`continuous daylight must block solar classification, default-seed timeline admissions, and retained show paint: ${failures.join('; ')}`);
});

test('RISK fireworks polar UTC: real Arctic daylight never schedules either source across a complete day',()=>{
 const context=sceneTimeline(),original=context.LandscapeConfig;
 context.LandscapeConfig={...original,spawnRate:actor=>['fireworks','festival'].includes(actor)?original.spawnRate(actor):0};vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-timeline.js'),'utf8'),context);
 const location={latitude:70,longitude:0,timezone:'UTC'},start=Date.parse('2026-06-21T00:00:00Z'),options={seed:'private-polar-midnight',location},timeline=context.LandscapeTimeline.create(options);
 for(let minute=0;minute<1440;minute++)assert.ok(!timeline.at(start+minute*60000).events.some(e=>['fireworks','festival'].includes(e.type)),`polar daylight excludes both UTC show sources at minute ${minute}`);
 assert.deepEqual(JSON.parse(JSON.stringify(timeline.at(start))),JSON.parse(JSON.stringify(context.LandscapeTimeline.create(options).at(start))),'real-location polar exclusion is reproducible after reload');
});

test('CLOUD REVISION: a higher cloud revision wins even when its server clock reads earlier', async () => {
  const local=syncState({tasks:[syncTask('shared','Later local')],syncRev:4,lastCloudServerAt:2000});
  const remote=syncState({tasks:[syncTask('shared','Newer revision')]});
  const h=makeSyncHarness({remote,rev:5}); h.doc.serverUpdatedAt={toMillis:()=>1000};
  const {ctx}=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(local)},cloudSyncFactory:h.factory});
  await ctx.cloudPull(); await syncSettle(PAST_DEBOUNCE);
  assert.equal(ctx.state.tasks[0].title,'Newer revision');
  assert.equal(h.remoteState().tasks[0].title,'Newer revision');
  assert.equal(h.conflicts,0);
});

test("REGRESSION: a device whose clock runs ahead cannot overwrite a newer revision", async () => {
  const now = Date.now();
  // The phone's work, at revision 12.
  const phone = cloudState(now - 6 * HOUR);
  phone.tasks[0].title = "Draft the chapter (renamed on my phone)";
  const h = makeSyncHarness({ remote: phone, rev: 12 });

  // The laptop: older content, revision 5, and a clock running hours FAST —
  // so by timestamp alone it looks newer than everything the phone did.
  const stale = staleState(now + 6 * HOUR);
  stale.syncRev = 5;
  const { ctx } = await loadApp({
    seed: 994,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(stale) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(titlesOf(ctx).includes("Draft the chapter (renamed on my phone)"),
    `the laptop must take the phone's newer revision, whatever its clock says: ${titlesOf(ctx)}`);
  assert.ok(h.remoteTitles().includes("Draft the chapter (renamed on my phone)"),
    "and the rename must still be in the cloud afterwards");
});

test("the revision this device last saw, not its clock, decides that it is ahead", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now + 6 * HOUR), rev: 7 });   // cloud clock ahead

  const local = staleState(now);            // slow clock, but same revision as the cloud
  local.syncRev = 7;
  const { ctx } = await loadApp({
    seed: 996,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(ctx.state.chain, STALE_CHAIN,
    "same base revision plus local edits means this device is ahead, slow clock or not");
  assert.deepEqual(h.remoteChain(), STALE_CHAIN, "so its work goes up");
});

test('RISK cloud generation recovery: the captured unreadable active generation reconciles an accepted board onto its intact prior generation',{timeout:90000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim,backend,originalRoot,activePath,priorPath,priorPayload}=app,store=ctx.window.ScannerDeviceStore;
 // Refuse only the first automatic publication so the local outcome is visible
 // before any cloud acknowledgement exists.
 refuseNextRecoveryTransaction255(app.faults);
 const before=JSON.stringify(ctx.state),beforeBoard=JSON.parse(before),syncRevBefore=ctx.state.syncRev;
 const cloudBefore=new Map([...backend.docs].map(([key,value])=>[key,JSON.stringify(value)]));
 ctx.closeModal();await flush();
 const serialized=await largeSerializedBytes2198(ctx,()=>ctx.cloudPull());
 t.diagnostic('multi-megabyte serialization during the recovery pull: '+serialized.calls+' calls, '+serialized.bytes+' characters');
 const hold=await store.getRecoveryCloudHold();
 const observed=vm.runInContext('JSON.stringify({cloud:window.CloudSync?.errorCode??null,unrepairable:unrepairableCloudSource?.code??null,resume:automaticCloudSourceResumeStatus?.state??null,accepted:liveBoardAccepted})',ctx);
 assert.ok(hold?.automaticRecovery===true&&hold.reason==='cloud-source-recovery','the captured state reconciles as an automatic recovery default instead of staying unaccepted; app state: '+observed);
 const titles=ctx.state.tasks.map(task=>task.title);
 assert.ok(titles.includes('Saved only in the intact prior generation'),'the complete prior generation supplies the working board');
 for(const task of beforeBoard.tasks)assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.tasks.find(row=>row.id===task.id)??null)),task,'every accepted task, including the newer local edit, survives unchanged');
 assert.ok(titles.includes('Newer local edit before reconciliation'));
 const plain=value=>JSON.parse(JSON.stringify(value??null));
 for(const key of ['decisionEvents','decisionBaseline','considered','cantAt','workedAt','chain','workLog','deletedTaskIds','clearedHistoryIds'])
  assert.deepEqual(plain(ctx.state[key]),plain(beforeBoard[key]),'every accepted board decision survives: '+key);
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the reconciled board is the exact durable head');
 assert.equal(ctx.state.syncRev,syncRevBefore,'the older generation never becomes the accepted revision');
 assert.equal(ctx.state.syncDirty,true,'reading an older complete source is not a cloud acknowledgement');
 for(const [key,raw] of cloudBefore)assert.equal(JSON.stringify(backend.docs.get(key)),raw,'every cloud source, including the damaged active generation, stays untouched: '+key);
 assert.equal(backend.docs.size,cloudBefore.size);
 const archives=await store.listOpaqueArchives(),rawArchive=archives.find(row=>row.key===hold.originalKey);
 assert.ok(rawArchive,'the exact device originals are archived before local adoption');
 const sourceArchive=JSON.parse(archives.find(row=>JSON.parse(rawArchive.raw).sourceArchiveKeys.includes(row.key)).raw);
 assert.equal(sourceArchive.defaultPolicy,'accepted-device-then-stable-source-key-v1');
 assert.equal(sourceArchive.acceptedDeviceBoard,before,'the unreconciled accepted board stays byte-exact');
 assert.ok(sourceArchive.candidateSources.some(row=>row.key==='cloud-generation:'+originalRoot.previousGeneration),'the selection is attributed to the prior generation');
 assert.deepEqual(sourceArchive.unsupported.filter(row=>row.sourceRef?.id===originalRoot.activeGeneration).map(row=>row.reason),['generation-incomplete'],'the damaged active generation is recorded, never adopted');
 const archivedPrior=sourceArchive.generations.find(row=>row.id===originalRoot.previousGeneration);
 assert.equal(await ctx.window.ChainStorageV2.decodeSnapshot(archivedPrior.header,archivedPrior.chunks),priorPayload,'the prior generation is archived exactly');
 assert.equal(backend.docs.get(activePath).chunkCount,CAPTURED_UNREADABLE_GENERATION.active.chunkCount);assert.ok(backend.docs.has(priorPath));
 // The outcome above is reached inside the product budget on this host; the
 // work count decides whether it also fits a phone, whatever this host's speed.
 assert.ok(serialized.bytes<=CAPTURED_PHONE_SERIALIZATION_BYTES,'one recovery pull serializes no more than a phone can inside the product budget: '+JSON.stringify({...serialized,limit:CAPTURED_PHONE_SERIALIZATION_BYTES}));
});
test('RISK cloud generation recovery: a readable active generation of the captured shape leaves the saved board, cloud and status exactly as before',{timeout:120000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{defect:false}),{ctx,shim,backend}=app,store=ctx.window.ScannerDeviceStore;
 const before=JSON.stringify(ctx.state),head=await store.readHead(),archives=await store.listOpaqueArchives();
 const cloudBefore=JSON.stringify([...backend.docs]),writes=backend.writes.length,reads=[];
 app.faults.serverRead=async path=>{reads.push(path);};t.after(()=>{delete app.faults.serverRead;});
 ctx.closeModal();await flush();await ctx.cloudPull();
 await fixtureDeadline(async wait=>{while(vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx))await wait(10);},'the healthy pull settles');
 const status=syncStatus2200(shim);
 t.diagnostic('healthy pull: '+JSON.stringify({status,reads,writes:backend.writes.length-writes,errorCode:ctx.window.CloudSync.errorCode??null,known:ctx.window.CloudSync.knownDamagedSource??null}));
 assert.equal(JSON.stringify(ctx.state),before,'the saved board is byte-for-byte the board before the pull');
 assert.deepEqual(await store.readHead(),head,'the durable head is unchanged');
 assert.deepEqual(await store.listOpaqueArchives(),archives,'no recovery archive is written');
 assert.equal(await store.getRecoveryCloudHold(),null,'no recovery hold is written');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud document is unchanged');
 assert.equal(backend.writes.length,writes,'the pull writes nothing to the cloud');
 assert.equal(ctx.window.CloudSync.errorCode??null,null);
 assert.deepEqual(status,RECORDED_HEALTHY_STATUS_8CD524A,'the sync status is the one main 8cd524a shows');
 assert.deepEqual(reads,RECORDED_HEALTHY_READS_8CD524A.map(path=>path.replace('<active>',app.activePath).replace('<root>','users/owner')),'the pull reads what main 8cd524a reads');
});

test('RISK cloud generation recovery: declining the reconciled prior generation through Paste Restore returns the unreconciled board',{timeout:240000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim,backend,originalRoot,activePath,priorPath}=app,store=ctx.window.ScannerDeviceStore;
 const before=JSON.stringify(ctx.state),beforeTitles=ctx.state.tasks.map(task=>task.title);
 const protectedSources=[...backend.docs].filter(([key])=>key===activePath||key===priorPath||key.startsWith(priorPath+'/')).map(([key,value])=>[key,JSON.stringify(value)]);
 ctx.closeModal();await flush();
 // The automatic default publishes through the guarded revision path. Under
 // load its first read budget can end after the local commit; the pending hold
 // then publishes on the next ordinary pull. Wait for the real acknowledgement.
 const settled=()=>vm.runInContext('JSON.stringify({dirty:state.syncDirty,pulling,pushing:cloudPushInFlight,busy:cloudSourceRecoveryBusy,hold:deviceRecoveryCloudHold?.reason??null,cloud:window.CloudSync?.errorCode??null})',ctx);
 const idle=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 for(let attempt=0;attempt<3&&(attempt===0||ctx.state.syncDirty||vm.runInContext('!!deviceRecoveryCloudHold',ctx));attempt++){
  if(attempt)assert.ok((await store.getRecoveryCloudHold())?.automaticRecovery,'only a committed automatic default may be published later');
  const pull=ctx.cloudPull();
  try{await fixtureDeadline(async wait=>{let done=false;pull.then(()=>{done=true;});while(!done||!idle())await wait(20);},
   'the automatic default read settles',CAPTURED_RESULT_BUDGET_MS+20000);}
  catch(error){error.message+='; app state: '+settled();throw error;}
 }
 assert.equal(ctx.state.syncDirty||vm.runInContext('!!deviceRecoveryCloudHold',ctx),false,'the automatic default reaches a real cloud acknowledgement; app state: '+settled());
 const published=backend.docs.get('users/owner');
 assert.equal(published.rev,originalRoot.rev+1,'publication is one guarded revision after the damaged one');
 assert.equal(published.previousGeneration,originalRoot.activeGeneration,'the damaged generation stays referenced, never overwritten');
 assert.ok(ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation'));
 // Decline: a deliberate Paste Restore of the board this device held before.
 ctx.onAction('open-paste-recovery',{});const box=shim.document.getElementById('jsonBox');box.id='jsonBox';box.value=before;
 shim.document.dispatchEvent({type:'input',target:box});
 assert.equal(await ctx.onAction('preview-pasted-recovery',{}),true);
 const reason=vm.runInContext('fileRestorePreview&&fileRestoreReadinessReason(fileRestorePreview)',ctx);
 assert.equal(await ctx.onAction('confirm-file-restore',{}),true,'the deliberate restore is available after the automatic default; refusal: '+reason);
 assert.deepEqual(ctx.state.tasks.map(task=>task.title),beforeTitles,'declining restores the unreconciled board rather than the older generation');
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the restored board is the exact durable head');
 const restored=await backend.CS.pull();
 assert.equal(JSON.parse(restored.payload).tasks.some(task=>task.title==='Saved only in the intact prior generation'),false,'the older generation is not what the cloud keeps after declining');
 for(const [key,raw] of protectedSources)assert.equal(JSON.stringify(backend.docs.get(key)),raw,'the damaged and prior generations remain protected: '+key);
});

// #2194 review F2: declining before publication. While the automatic recovery
// default is still pending and unpublished, Settings offers to return to the
// exact board this device held before reconciliation. Nothing is published,
// every source stays protected, and deliberate Restore stays available.
test('RISK cloud generation recovery: declining the pending automatic recovery default in Settings restores the unreconciled board before any publication',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim,backend,originalRoot,activePath,priorPath}=app,store=ctx.window.ScannerDeviceStore;
 // The first automatic publication is refused, so the default stays pending.
 refuseNextRecoveryTransaction255(app.faults);
 const before=JSON.stringify(ctx.state),beforeHead=(await store.readHead()).payload;
 const cloudBefore=JSON.stringify([...backend.docs]),writes=backend.writes.length;
 const idle=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 const settle=message=>fixtureDeadline(async wait=>{await wait(5);while(!idle())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);
 ctx.closeModal();await flush();await ctx.cloudPull();await settle('the automatic default settles unpublished');
 const pending=await store.getRecoveryCloudHold();
 assert.ok(pending?.automaticRecovery===true&&pending.reason==='cloud-source-recovery','positive control: the automatic default is pending');
 assert.ok(ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation'),'positive control: the older generation is in use');
 assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev,'nothing has been published');
 const archivesBefore=await store.listOpaqueArchives();
 ctx.openSettings();
 const settings=shim.document.getElementById('modalRoot').innerHTML;
 assert.match(settings,/data-act="decline-automatic-cloud-recovery"/,'Settings offers to decline the pending automatic recovery default');
 // The established keyboard path from Review cloud recovery to the next
 // recovery control (the native recovery consumer) stays unchanged.
 const order=['decline-automatic-cloud-recovery','review-cloud-source-recovery','sync-signout'].map(act=>settings.indexOf('data-act="'+act+'"'));
 assert.ok(order.every(at=>at>=0)&&order[0]<order[1]&&order[1]<order[2],'the decline precedes Review cloud recovery, so Review still moves forward to the next recovery control: '+JSON.stringify(order));
 assert.equal(await ctx.onAction('decline-automatic-cloud-recovery',{}),true,'declining succeeds while the default is unpublished');
 assert.equal(JSON.stringify(ctx.state),before,'declining restores the exact board this device held before reconciliation');
 assert.equal((await store.readHead()).payload,beforeHead,'the restored board is the exact durable head');
 assert.equal(await store.getRecoveryCloudHold(),null,'the pending automatic publication is cancelled');
 const archivesAfter=await store.listOpaqueArchives();
 for(const row of archivesBefore)assert.ok(archivesAfter.some(saved=>saved.key===row.key&&saved.raw===row.raw),'every recovery source stays protected: '+row.key);
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'the damaged generation and every cloud source stay untouched');
 // A later ordinary pull neither publishes the older copy nor reapplies it.
 await ctx.cloudPull();await settle('a later pull settles');
 assert.equal(JSON.stringify(ctx.state),before,'the declined default is not reapplied by the next pull');
 assert.equal(await store.getRecoveryCloudHold(),null);
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'nothing is published after declining');assert.equal(backend.writes.length,writes);
 await ctx.onAction('undo',{});await ctx.persist();
 assert.equal(ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation'),false,'Undo never brings back the declined older copy');
 // Deliberate File or Paste Restore stays reachable.
 ctx.openSettings();
 assert.match(shim.document.getElementById('modalRoot').innerHTML,/data-act="restore-backup"/,'deliberate File or Paste Restore stays reachable');
 ctx.closeModal();await flush();ctx.onAction('open-paste-recovery',{});const box=shim.document.getElementById('jsonBox');box.id='jsonBox';box.value=before;
 shim.document.dispatchEvent({type:'input',target:box});
 assert.equal(await ctx.onAction('preview-pasted-recovery',{}),true,'a deliberate Paste Restore preview opens after declining');
 await ctx.onAction('cancel-file-restore',{});
 // A relaunch over the same unchanged root does not reapply the declined default.
 await closeLegacyApp173(app);backend.CS.suspend();
 const coldReads=[],cold=await coldRelaunch2198(t,app,coldReads);
 assert.equal(cold.ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation'),false,'a relaunch does not reapply the declined older copy');
 assert.equal(await cold.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),null);
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected after relaunch');
 assert.ok(backend.docs.has(activePath)&&backend.docs.has(priorPath));
});

// #2194 review L1: the decline is remembered in device storage so the next
// pull does not apply the older copy again. If that record cannot be written,
// a decline reported as done would be silently undone and published; it must
// fail closed instead, leaving the pending default exactly as it was.
test('RISK cloud generation recovery: a decline whose choice cannot be remembered fails closed and a reported decline is never reapplied or published',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 // Publication stays refused until the decline has been attempted.
 const refusal=Object.assign(Error('Controlled automatic publication refusal'),{code:'permission-denied'});let refusePublication=true;
 Object.defineProperty(app.faults,'push',{configurable:true,get(){return refusePublication?refusal:undefined;}});
 t.after(()=>{delete app.faults.push;});
 const idle=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 const settle=message=>fixtureDeadline(async wait=>{await wait(5);while(!idle())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);
 const olderOnly=()=>ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation');
 ctx.closeModal();await flush();await ctx.cloudPull();await settle('the automatic default settles unpublished');
 const pending=await store.getRecoveryCloudHold();
 assert.ok(pending?.automaticRecovery===true,'positive control: the automatic default is pending');
 assert.ok(olderOnly(),'positive control: the older generation is in use');
 assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev,'positive control: nothing has been published');
 const recovered=JSON.stringify(ctx.state),recoveredHead=(await store.readHead()).payload;
 // The device cannot remember the choice (a full origin quota, for example).
 const key='fvp:chain-scanner:declined-automatic-cloud-recovery',setItem=shim.localStorage.setItem;let markerWrites=0;
 shim.localStorage.setItem=function(name,value){if(name===key){markerWrites++;throw Object.assign(Error('Synthetic quota exceeded'),{name:'QuotaExceededError'});}return setItem.call(this,name,value);};
 let declined;
 try{declined=await ctx.onAction('decline-automatic-cloud-recovery',{});}finally{shim.localStorage.setItem=setItem;}
 const afterDecline={state:JSON.stringify(ctx.state),head:(await store.readHead()).payload,hold:await store.getRecoveryCloudHold()};
 // Storage and the cloud then work again, and the next ordinary pull runs.
 refusePublication=false;const next=ctx.cloudPull();let nextDone=false;next.then(()=>{nextDone=true;},()=>{nextDone=true;});
 await fixtureDeadline(async wait=>{await wait(5);while(!nextDone||!idle())await wait(20);},'the next pull settles',CAPTURED_RESULT_BUDGET_MS+20000);
 const reapplied=olderOnly(),published=backend.docs.get('users/owner').rev!==originalRoot.rev;
 assert.equal(markerWrites,1,'the decline tried to remember the choice');
 assert.ok(!(declined===true&&(reapplied||published)),'a decline reported as done is never reapplied or published by the next pull: '+JSON.stringify({declined,reapplied,published}));
 assert.equal(declined,false,'a decline whose choice cannot be remembered fails closed');
 assert.equal(afterDecline.state,recovered,'the refused decline leaves the working board unchanged');
 assert.equal(afterDecline.head,recoveredHead,'the refused decline writes nothing to the device');
 assert.deepEqual(afterDecline.hold,pending,'the refused decline keeps the pending automatic default exactly');
});

// #2194 FAQ review B2: while the automatic default is pending, cloud saving is
// held, so a signed-in Restore is refused. A refused decline must point to a
// route that works then, Review cloud recovery, rather than to Restore.
test('RISK cloud generation recovery: a refused decline after later edits points to Review cloud recovery, which works while a signed-in Restore is held',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
 const refusal=Object.assign(Error('Controlled automatic publication refusal'),{code:'permission-denied'});
 Object.defineProperty(app.faults,'push',{configurable:true,get(){return refusal;}});t.after(()=>{delete app.faults.push;});
 const idle=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 const settle=message=>fixtureDeadline(async wait=>{await wait(5);while(!idle())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);
 const unreconciled=JSON.stringify(ctx.state);
 ctx.closeModal();await flush();const opening=ctx.cloudPull();let opened=false;opening.then(()=>{opened=true;},()=>{opened=true;});
 await fixtureDeadline(async wait=>{await wait(5);while(!opened||!idle())await wait(20);},'the automatic default settles unpublished',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.ok((await store.getRecoveryCloudHold())?.automaticRecovery===true,'positive control: the automatic default is pending');
 // The person keeps working on the older copy, as the label invites.
 shim.document.getElementById('addInput').value='Work added after recovery';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);await settle('the edit settles');
 const edited=JSON.stringify(ctx.state);
 assert.equal(await ctx.onAction('decline-automatic-cloud-recovery',{}),false,'positive control: the decline is refused after later edits');
 const message=shim.document.getElementById('toast').textContent;
 assert.equal(JSON.stringify(ctx.state),edited,'the refused decline changes nothing');
 // The premise: a signed-in deliberate Restore is held while the default is pending.
 ctx.closeModal();await flush();ctx.onAction('open-paste-recovery',{});const box=shim.document.getElementById('jsonBox');box.id='jsonBox';box.value=unreconciled;
 shim.document.dispatchEvent({type:'input',target:box});await ctx.onAction('preview-pasted-recovery',{});
 const restoreRefusal=vm.runInContext('fileRestorePreview?fileRestoreReadinessReason(fileRestorePreview):"no preview"',ctx);
 await ctx.onAction('cancel-file-restore',{});ctx.closeModal();await flush();
 assert.match(String(restoreRefusal),/Cloud sync is held/,'a signed-in Restore is held while the automatic default is pending');
 assert.doesNotMatch(message,/\bRestore\b/,'the refusal does not send the person to a Restore that is held: '+message);
 assert.match(message,/Review cloud recovery/,'the refusal names Review cloud recovery: '+message);
 ctx.openSettings();
 assert.match(shim.document.getElementById('modalRoot').innerHTML,/data-act="review-cloud-source-recovery"[^>]*>Review cloud recovery</,'Settings offers Review cloud recovery beside the decline');
 const review=ctx.onAction('review-cloud-source-recovery',{});let reviewed=false;Promise.resolve(review).then(()=>{reviewed=true;},()=>{reviewed=true;});
 await fixtureDeadline(async wait=>{await wait(5);while(!reviewed||!idle())await wait(20);},'Review cloud recovery reads the sources',CAPTURED_RESULT_BUDGET_MS+20000);
 const dialog=shim.document.getElementById('modalRoot').innerHTML;
 assert.match(dialog,/Complete board open on this device/,'Review cloud recovery opens with the sources to choose from');
 assert.match(dialog,/data-act="apply-cloud-source-recovery"/,'Review cloud recovery offers a deliberate choice');
});

// #2194 independent review B1: the decline's busy check counted the Settings
// modal it is pressed from as an active editor, so in a real document every
// press was refused with "A save or edit is running". Pressed from the open
// Settings modal through the real click dispatcher, it must succeed.
test('RISK cloud generation recovery: Use my board from before recovery succeeds when pressed in the open Settings modal',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim,backend}=app,store=ctx.window.ScannerDeviceStore;
 const before=JSON.stringify(ctx.state),beforeHead=(await store.readHead()).payload;
 const {idle}=await pendingAutomaticDefault2194(t,app);
 const cloudBefore=JSON.stringify([...backend.docs]);
 t.after(faithfulModalQuery2194(shim));
 ctx.openSettings();
 assert.ok(shim.document.querySelector('.mback, dialog[open]'),'positive control: the document reports the open Settings modal');
 assert.match(shim.document.getElementById('modalRoot').innerHTML,/data-act="decline-automatic-cloud-recovery"/,'Settings offers the decline');
 shim.document.getElementById('toast').textContent='';
 // A real press: pointerdown (which marks a scanner gesture) precedes the click.
 const button=declineButton2194();
 shim.document.dispatchEvent({type:'pointerdown',target:button});shim.document.dispatchEvent({type:'click',detail:1,target:button});
 await fixtureDeadline(async wait=>{await wait(5);while(!idle()||((await store.getRecoveryCloudHold())&&!shim.document.getElementById('toast').textContent))await wait(20);},'the decline settles',CAPTURED_RESULT_BUDGET_MS+20000);
 const message=shim.document.getElementById('toast').textContent;
 assert.doesNotMatch(message,/save or edit is running/i,'the Settings modal the decline is pressed from is not an active editor: '+message);
 assert.equal(await store.getRecoveryCloudHold(),null,'the decline releases the pending automatic default: '+message);
 assert.equal(JSON.stringify(ctx.state),before,'the decline restores the exact board from before recovery');
 assert.equal((await store.readHead()).payload,beforeHead,'the restored board is the exact durable head');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'nothing is published');
});

// #2194 independent review N2: nothing re-checked the board after the
// decline's device commit, so closing Settings (Escape) and adding a task
// while that commit was in flight let the decline replace the new edit.
// Board input stays held until the decline finishes; no edit is replaced.
test('RISK cloud generation recovery: an edit attempted while the decline commits is never replaced and Settings stays open until it finishes',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim,backend}=app,store=ctx.window.ScannerDeviceStore;
 const before=JSON.stringify(ctx.state);
 const {idle}=await pendingAutomaticDefault2194(t,app);
 t.after(faithfulModalQuery2194(shim));
 // Hold only the decline's own device commit so input can be attempted during it.
 const commitHead=store.commitHead;let release,entered=false;const gate=new Promise(resolve=>{release=resolve;});
 store.commitHead=async function(options){if(options?.releaseRecoveryHold){entered=true;await gate;}return commitHead.call(this,options);};
 t.after(()=>{store.commitHead=commitHead;release();});
 ctx.openSettings();shim.document.getElementById('toast').textContent='';
 shim.document.dispatchEvent({type:'click',detail:1,target:declineButton2194()});
 await fixtureDeadline(async wait=>{while(!entered&&!shim.document.getElementById('toast').textContent)await wait(10);},'the decline reaches its device commit',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.equal(entered,true,'positive control: the decline reaches its device commit: '+shim.document.getElementById('toast').textContent);
 // Escape closes Settings, then Enter in Add submits a new task.
 const closed=ctx.closeModal();
 const title='Task added while the decline commits';
 shim.document.getElementById('addInput').value=title;await ctx.onAction('add',{});
 const accepted=ctx.state.tasks.some(task=>task.title===title);
 shim.document.getElementById('toast').textContent='';release();
 // The decline ends with its own toast, success or refusal.
 await fixtureDeadline(async wait=>{await wait(5);while(!idle()||!shim.document.getElementById('toast').textContent)await wait(20);},'the decline finishes',CAPTURED_RESULT_BUDGET_MS+20000);
 const outcome=shim.document.getElementById('toast').textContent;
 await ctx.persist();
 const kept=ctx.state.tasks.some(task=>task.title===title)||shim.document.getElementById('addInput').value===title;
 assert.ok(kept,'the edit attempted during the decline is never replaced: it is either on the board or still in the Add field ('+JSON.stringify({closed,accepted,outcome})+')');
 assert.equal(accepted,false,'board input is held while the decline commits ('+outcome+')');
 assert.equal(closed,false,'Settings stays open while the decline commits');
 assert.equal(JSON.stringify(ctx.state),before,'the decline still restores the exact board from before recovery');
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the device head matches the board on screen');
});

// #2194 independent review N1: a decline cancelled the in-flight automatic
// recovery read and the requested background resume before its refusal
// checks, so a refused decline still paused automatic cloud confirmation until
// the next focus, pageshow or online event. A refused decline changes nothing.
test('RISK cloud generation recovery: a refused decline leaves the automatic recovery read and its requested resume in place',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
 const {idle}=await pendingAutomaticDefault2194(t,app);
 t.after(faithfulModalQuery2194(shim));
 // Keep working on the older copy, so the decline must refuse.
 shim.document.getElementById('addInput').value='Work kept on the older copy';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await fixtureDeadline(async wait=>{await wait(5);while(!idle())await wait(20);},'the edit settles',CAPTURED_RESULT_BUDGET_MS+20000);
 const pending=await store.getRecoveryCloudHold();
 // A returning tab requests the automatic resume (the app's own focus path),
 // and an automatic recovery read is in flight (a local working recovery).
 vm.runInContext('resumeCloudSync({type:"focus"})',ctx);
 await fixtureDeadline(async wait=>{await wait(5);while(!idle())await wait(20);},'the focus pull settles',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.equal(vm.runInContext('automaticCloudSourceResumeRequested',ctx),true,'positive control: the focus requested the automatic resume');
 vm.runInContext('globalThis.__read2194={controller:new AbortController(),automaticFallback:true,serial:cloudSourceRecoverySerial};cloudSourceRecoveryRead=__read2194;cloudSourceRecoveryBusy=false;',ctx);
 t.after(()=>{try{vm.runInContext('if(cloudSourceRecoveryRead===globalThis.__read2194)cloudSourceRecoveryRead=null;',ctx);}catch{}});
 ctx.openSettings();shim.document.getElementById('toast').textContent='';
 assert.equal(await ctx.onAction('decline-automatic-cloud-recovery',{}),false,'positive control: the decline is refused after later edits');
 const message=shim.document.getElementById('toast').textContent;
 assert.match(message,/Board changed since recovery/,'the refusal is the board-changed case: '+message);
 assert.equal(vm.runInContext('__read2194.controller.signal.aborted',ctx),false,'a refused decline does not abort the automatic recovery read');
 assert.equal(vm.runInContext('cloudSourceRecoveryRead===__read2194',ctx),true,'a refused decline keeps the automatic recovery read current');
 assert.equal(vm.runInContext('automaticCloudSourceResumeRequested',ctx),true,'a refused decline keeps the requested automatic resume');
 assert.deepEqual(await store.getRecoveryCloudHold(),pending,'the refused decline keeps the pending automatic default exactly');
});

test('RISK cloud generation recovery: a conflicting or different-account prior generation still waits and is never adopted',{timeout:180000},async t=>{
 for(const variant of ['ambiguous legacy rating','different account'])await t.test(variant,{timeout:90000},async sub=>{
  const app=await capturedGenerationAcceptedApp2198(sub,{priorVariant:variant}),{ctx,backend}=app,store=ctx.window.ScannerDeviceStore;
  refuseNextRecoveryTransaction255(app.faults);
  const before=JSON.stringify(ctx.state),head=await store.readHead(),cloudBefore=JSON.stringify([...backend.docs]);
  ctx.closeModal();await flush();await ctx.cloudPull();
  assert.equal(ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation'),false,'the unsafe prior generation is never adopted automatically');
  assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected and unpublished');
  if(variant==='ambiguous legacy rating'){
   assert.equal(JSON.stringify(ctx.state),before,'a conflicting source waits for safe recovery');
   assert.deepEqual(await store.readHead(),head);assert.equal(await store.getRecoveryCloudHold(),null);
  }else{
   for(const task of JSON.parse(before).tasks)assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.tasks.find(row=>row.id===task.id)??null)),task,'accepted work is unchanged');
   assert.equal(ctx.state.tasks.length,JSON.parse(before).tasks.length,'another account contributes nothing to this board');
  }
 });
});

// #2201: the captured export re-downloaded the same unreadable generation and
// its multi-megabyte prior on every opening. A completed refusal over an
// unchanged server root is reused; the root itself is still read from the
// server each time, and Retry or an account change proves everything again.
test('RISK corrupt cloud work budget: resuming over an unchanged unreadable generation keeps its completed refusal without downloading it again',{timeout:180000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{priorVariant:'ambiguous legacy rating',recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim,backend,originalRoot,activePath,priorPath}=app,store=ctx.window.ScannerDeviceStore;
 const reads=[];app.faults.serverRead=async path=>{reads.push(path);};t.after(()=>{delete app.faults.serverRead;});
 const generationReads=since=>reads.slice(since).filter(path=>path.startsWith(activePath)||path.startsWith(priorPath));
 const settled=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 const settle=async message=>fixtureDeadline(async wait=>{await wait(5);while(!settled())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);
 const before=JSON.stringify(ctx.state),head=await store.readHead(),cloudBefore=JSON.stringify([...backend.docs]),writes=backend.writes.length;
 ctx.closeModal();await flush();await ctx.cloudPull();await settle('the first opening read settles');
 assert.equal(backend.CS.errorCode,'corrupt-generation');
 assert.equal(JSON.stringify(ctx.state),before,'the conflicting prior generation waits; the accepted board is unchanged');
 assert.deepEqual(await store.readHead(),head);assert.equal(await store.getRecoveryCloudHold(),null);
 const firstOpen=reads.length,firstChunks=generationReads(0).filter(path=>path.endsWith('/chunks'));
 assert.ok(firstChunks.includes(activePath+'/chunks')&&firstChunks.includes(priorPath+'/chunks'),'the first opening proves both sources from the server');
 t.diagnostic('First opening: '+firstOpen+' server reads, '+firstChunks.length+' generation chunk reads');
 // Returning to the app (hide, then show) and a later automatic pull.
 shim.document.hidden=true;vm.runInContext('suspendCloudSync()',ctx);shim.document.hidden=false;
 // resumeCloudSync starts its pull without returning it: wait for its first
 // server read, then for the pull to finish, so an early check cannot pass empty.
 const beforeResume=reads.length;vm.runInContext('resumeCloudSync({type:"visibilitychange"})',ctx);
 await fixtureDeadline(async wait=>{while(reads.length===beforeResume||!settled())await wait(10);},'the resumed read settles',CAPTURED_RESULT_BUDGET_MS+20000);
 const resumed=reads.slice(firstOpen);
 t.diagnostic('Resume: '+resumed.length+' server reads '+JSON.stringify(resumed));
 assert.deepEqual(generationReads(firstOpen),[],'resuming over the unchanged root downloads neither the unreadable generation nor its prior again');
 assert.ok(resumed.includes('users/owner'),'the root is still read from the server, so a changed manifest is never missed');
 const afterResume=reads.length;await ctx.cloudPull();await settle('a later automatic pull settles');
 assert.deepEqual(reads.slice(afterResume),['users/owner'],'a later automatic pull costs one server root read');
 // The held source still bounds ordinary work after the resume.
 ctx.window.CLOUD_PUSH_DELAY_MS=0;const afterPull=reads.length;
 shim.document.getElementById('addInput').value='Local work after resuming a held source';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await settle('the ordinary edit settles');
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the ordinary edit is durable');
 assert.deepEqual(reads.slice(afterPull),[],'an ordinary edit after resuming triggers no cloud download');
 assert.equal(ctx.state.syncDirty,true,'device durability is not a cloud acknowledgement');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected');assert.equal(backend.writes.length,writes);
 // Explicit Retry proves the answer again from the server.
 const beforeRetry=reads.length;await ctx.onAction('sync-retry',{});await settle('Retry settles');
 assert.ok(generationReads(beforeRetry).includes(activePath+'/chunks'),'explicit Retry downloads and checks the unreadable generation again');
 // An account change never inherits the earlier account session's conclusion.
 // The harness delivers the sign-in pull explicitly, as the cold-open fixtures do.
 const beforeAccount=reads.length;backend.emitAuth(null);await flush();backend.emitAuth({uid:'owner',email:'owner@example.test'});await flush();
 await ctx.cloudPull();await settle('the re-signed-in read settles');
 assert.ok(generationReads(beforeAccount).includes(activePath+'/chunks'),'signing in again proves the source again');
 assert.ok(ctx.state.tasks.some(task=>task.title==='Local work after resuming a held source'));
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected after Retry and sign-in');
});
test('RISK corrupt cloud work budget: a cold launch over an unchanged unreadable generation keeps its completed refusal without downloading it again',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{priorVariant:'ambiguous legacy rating'}),{ctx,backend,activePath,priorPath}=app,store=ctx.window.ScannerDeviceStore;
 const reads=[];app.faults.serverRead=async path=>{reads.push(path);};t.after(()=>{delete app.faults.serverRead;});
 const generationReads=since=>reads.slice(since).filter(path=>path.startsWith(activePath)||path.startsWith(priorPath));
 const settled=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 ctx.closeModal();await flush();await ctx.cloudPull();
 await fixtureDeadline(async wait=>{await wait(5);while(!settled())await wait(10);},'the first opening settles',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.equal(backend.CS.errorCode,'corrupt-generation');assert.equal(await store.getRecoveryCloudHold(),null);
 assert.ok(generationReads(0).includes(activePath+'/chunks')&&generationReads(0).includes(priorPath+'/chunks'),'saved data without a remembered conclusion proves both sources, as before');
 const head=(await store.readHead()).payload,cloudBefore=JSON.stringify([...backend.docs]),writes=backend.writes.length;
 await closeLegacyApp173(app);backend.CS.suspend();
 // The installed app is relaunched over the same unchanged server root.
 const coldReads=[],cold=await coldRelaunch2198(t,app,coldReads);
 t.diagnostic('Cold launch: '+coldReads.length+' server reads '+JSON.stringify(coldReads));
 assert.ok(coldReads.includes('users/owner'),'the root is still read from the server on a cold launch');
 assert.equal(cold.backend.CS.errorCode,'corrupt-generation','the cold launch still reports the unreadable generation');
 assert.deepEqual(coldReads.filter(path=>path.startsWith(activePath)||path.startsWith(priorPath)),[],'a cold launch over the unchanged root downloads neither the unreadable generation nor its prior again');
 const coldStore=cold.ctx.window.ScannerDeviceStore;
 assert.equal((await coldStore.readHead()).payload,head,'the remembered conclusion never produces a board');
 assert.equal(await coldStore.getRecoveryCloudHold(),null);
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected');assert.equal(backend.writes.length,writes);
 // The relaunched app's ordinary edits are still held without downloads.
 cold.ctx.window.CLOUD_PUSH_DELAY_MS=0;const beforeEdit=coldReads.length;
 cold.shim.document.getElementById('addInput').value='Local work after a cold launch';await cold.ctx.onAction('add',{});assert.equal(await cold.ctx.persist(),true);
 await cold.settle('the ordinary edit settles');
 assert.deepEqual(coldReads.slice(beforeEdit),[],'an ordinary edit after the cold launch triggers no cloud download');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore);
 // Explicit Retry proves the answer again from the server.
 const beforeRetry=coldReads.length;await cold.ctx.onAction('sync-retry',{});await cold.settle('Retry settles');
 assert.ok(coldReads.slice(beforeRetry).includes(activePath+'/chunks'),'explicit Retry downloads and checks the unreadable generation again');
 // Signing out ends the conclusion: the next cold launch proves it again.
 cold.backend.emitAuth(null);await flush();await cold.settle('sign-out settles');
 await closeLegacyApp173(cold);cold.backend.CS.suspend();
 const afterSignOut=[],again=await coldRelaunch2198(t,app,afterSignOut);
 assert.ok(afterSignOut.includes(activePath+'/chunks'),'after signing out, the next sign-in proves the source again');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected after Retry and sign-out');
 assert.ok(again.ctx.state.tasks.some(task=>task.title==='Local work after a cold launch'));
});

// #2228 (spec #2224): the non-memory behaviour of an automatic recovery
// default that waits because it is over its work budget. The captured shape
// (#2195) is about 2 MB of work, under the product budget, so these tests lower
// the budget to 1 MiB through the app's own override; the large-board browser
// test covers the product budget itself. The wait is a completed refusal over
// the unchanged root: it publishes nothing, grants no cloud acknowledgement and
// is not evaluated again by resuming, reconnecting or a cold launch, while
// Retry sync and signing in again run recovery deliberately and a changed
// generation is evaluated afresh.
const RECOVERY_WAIT_BUDGET_2228=1048576;
const recoveryWaitIdle2228=ctx=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy||saveTimer!==null||supportDiagnosticsActivePersistCalls>0',ctx);
const recoveryWaitSettle2228=(ctx,message)=>fixtureDeadline(async wait=>{await wait(5);while(!recoveryWaitIdle2228(ctx))await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);
const recoveryBudgetEvents2228=ctx=>JSON.parse(ctx.supportDiagnosticsText()).events.filter(event=>event.stage==='recovery-budget');
test('RISK recovery wait: an over-budget automatic recovery default waits without publishing and is not repeated by resuming, reconnecting or a cold launch over the unchanged generation',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim,backend,activePath,priorPath}=app,store=ctx.window.ScannerDeviceStore;
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=RECOVERY_WAIT_BUDGET_2228;
 const reads=[];app.faults.serverRead=async path=>{reads.push(path);};t.after(()=>{delete app.faults.serverRead;});
 const generationReads=(list,since)=>list.slice(since).filter(path=>path.startsWith(activePath)||path.startsWith(priorPath));
 const PRIOR='Saved only in the intact prior generation',before=JSON.stringify(ctx.state),head=await store.readHead();
 const cloudBefore=JSON.stringify([...backend.docs]),writes=backend.writes.length,base=JSON.stringify(ctx.state.decisionBase);
 ctx.closeModal();await flush();await ctx.cloudPull();await recoveryWaitSettle2228(ctx,'the opening settles');
 // It waits: the accepted board, its durable head and every source are unchanged.
 assert.equal(backend.CS.errorCode,'corrupt-generation');
 assert.equal(JSON.stringify(ctx.state),before,'the accepted board stays exactly as it was');
 assert.deepEqual(await store.readHead(),head);assert.equal(await store.getRecoveryCloudHold(),null,'no recovery default was adopted');
 assert.equal(ctx.state.tasks.some(task=>task.title===PRIOR),false,'nothing from the earlier generation is applied');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'nothing is published');assert.equal(backend.writes.length,writes);
 assert.equal(ctx.state.syncDirty,true,'no cloud acknowledgement');assert.equal(JSON.stringify(ctx.state.decisionBase),base);
 assert.equal(syncStatus2200(shim).text,'☁ recovery waiting');assert.match(syncStatus2200(shim).title,/Cloud recovery is waiting/);
 ctx.openSettings();const settings=shim.document.getElementById('modalRoot').innerHTML;ctx.closeModal();
 assert.match(settings,/Cloud recovery is waiting\./);assert.match(settings,/data-act="review-cloud-source-recovery"/);assert.match(settings,/data-act="restore-backup"/);
 // Metadata only: the stage, sizes rounded to KiB and the budget outcome.
 const events=recoveryBudgetEvents2228(ctx);
 assert.equal(events.length,1,'one budget evaluation is recorded');
 const {metadata}=events[0];
 assert.equal(metadata.budgetOutcome,'deferred');assert.equal(metadata.budgetKiB,1024);
 assert.equal(metadata.generationKiB,Math.round(CAPTURED_UNREADABLE_GENERATION.prior.byteLength/1024),'the complete earlier generation is counted from its header');
 for(const key of ['boardKiB','decisionKiB','estimateKiB'])assert.ok(Number.isSafeInteger(metadata[key])&&metadata[key]>=0,key);
 assert.equal(metadata.estimateKiB>metadata.budgetKiB,true);
 assert.doesNotMatch(ctx.supportDiagnosticsText(),/Newer local edit before reconciliation|Acknowledged before source damage|owner@|e@example/,'no board text or account in the debug log');
 // An ordinary edit saves on this device and publishes nothing.
 ctx.window.CLOUD_PUSH_DELAY_MS=0;const beforeEdit=reads.length;
 shim.document.getElementById('addInput').value='Local work while recovery waits';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await recoveryWaitSettle2228(ctx,'the ordinary edit settles');
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the edit is durable on this device');
 assert.deepEqual(generationReads(reads,beforeEdit),[],'an edit does not start recovery');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'nothing is published after an edit');assert.equal(backend.writes.length,writes);
 assert.equal(ctx.state.syncDirty,true);assert.equal(syncStatus2200(shim).text,'☁ recovery waiting');
 // Resuming and reconnecting over the unchanged root do not evaluate it again.
 for(const type of ['visibilitychange','online']){
  if(type==='visibilitychange'){shim.document.hidden=true;vm.runInContext('suspendCloudSync()',ctx);shim.document.hidden=false;}
  const at=reads.length;vm.runInContext('resumeCloudSync({type:'+JSON.stringify(type)+'})',ctx);
  await fixtureDeadline(async wait=>{while(reads.length===at||!recoveryWaitIdle2228(ctx))await wait(10);},'the '+type+' read settles',CAPTURED_RESULT_BUDGET_MS+20000);
  assert.deepEqual(generationReads(reads,at),[],type+' over the unchanged root downloads neither generation again');
  assert.ok(reads.slice(at).includes('users/owner'),type+' still reads the server root');
  assert.equal(syncStatus2200(shim).text,'☁ recovery waiting',type+' keeps the waiting status');
 }
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore);assert.equal(backend.writes.length,writes);
 // A cold launch over the unchanged root does not evaluate it again either.
 const edited=JSON.stringify(ctx.state);await closeLegacyApp173(app);backend.CS.suspend();
 const coldReads=[],cold=await coldRelaunch2198(t,app,coldReads,{signIn:false});
 cold.ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=RECOVERY_WAIT_BUDGET_2228;
 cold.backend.emitAuth({uid:'owner',email:'e@example.com'});cold.ctx.closeModal();await flush();await cold.ctx.cloudPull();await cold.settle('the cold launch settles');
 assert.equal(cold.backend.CS.errorCode,'corrupt-generation');assert.ok(coldReads.includes('users/owner'));
 assert.deepEqual(coldReads.filter(path=>path.startsWith(activePath)||path.startsWith(priorPath)),[],'a cold launch over the unchanged root downloads neither generation again');
 assert.equal(JSON.stringify(cold.ctx.state),edited,'the cold launch opens the same accepted board');
 assert.equal(await cold.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),null);
 assert.equal(syncStatus2200(cold.shim).text,'☁ recovery waiting','a cold launch still says cloud recovery is waiting');
 assert.equal(recoveryBudgetEvents2228(cold.ctx).length,0,'a cold launch did not evaluate the budget again');
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore);
});
test('RISK recovery wait: Retry sync and signing in again run a waiting recovery deliberately',{timeout:300000},async t=>{
 for(const route of ['Retry sync','signing in again'])await t.test(route,{timeout:150000},async sub=>{
  const app=await capturedGenerationAcceptedApp2198(sub),{ctx,shim,backend}=app;
  ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=RECOVERY_WAIT_BUDGET_2228;
  const PRIOR='Saved only in the intact prior generation';
  ctx.closeModal();await flush();await ctx.cloudPull();await recoveryWaitSettle2228(ctx,'the opening settles');
  assert.equal(syncStatus2200(shim).text,'☁ recovery waiting','positive control: recovery waits');
  assert.equal(ctx.state.tasks.some(task=>task.title===PRIOR),false);
  ctx.window.CLOUD_PUSH_DELAY_MS=0;
  shim.document.getElementById('addInput').value='Local work while recovery waits';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
  await recoveryWaitSettle2228(ctx,'the ordinary edit settles');
  // Publication is refused, so the deliberate run's outcome stays visible
  // before any cloud acknowledgement, as in the #2198 recovery tests.
  refuseNextRecoveryTransaction255(app.faults);
  if(route==='Retry sync'){await ctx.onAction('sync-retry',{});}
  else{
   backend.emitAuth(null);await flush();await recoveryWaitSettle2228(ctx,'sign-out settles');
   assert.equal(ctx.state.tasks.some(task=>task.title===PRIOR),false,'signing out alone runs nothing');
   backend.emitAuth({uid:'owner',email:'e@example.com'});await flush();await ctx.cloudPull();
  }
  await recoveryWaitSettle2228(ctx,route+' settles');
  assert.ok(ctx.state.tasks.some(task=>task.title===PRIOR),route+' runs the recovery default onto the earlier generation');
  assert.ok(ctx.state.tasks.some(task=>task.title==='Local work while recovery waits'),'the edit made while waiting is kept');
  assert.ok(ctx.state.tasks.some(task=>task.title==='Newer local edit before reconciliation'),'the newer accepted edit is kept');
  assert.equal((await ctx.window.ScannerDeviceStore.getRecoveryCloudHold())?.automaticRecovery,true,'the recovery default is pending its guarded publication');
  assert.equal(syncStatus2200(shim).text,'☁ older copy in use','the wait has ended');
 });
});
test('RISK recovery wait: a changed unreadable generation is evaluated afresh and a readable one ends the wait',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim,backend,originalRoot,activePath}=app;
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=RECOVERY_WAIT_BUDGET_2228;
 const reads=[];app.faults.serverRead=async path=>{reads.push(path);};t.after(()=>{delete app.faults.serverRead;});
 ctx.closeModal();await flush();await ctx.cloudPull();await recoveryWaitSettle2228(ctx,'the opening settles');
 assert.equal(syncStatus2200(shim).text,'☁ recovery waiting','positive control: recovery waits');
 const cloudBefore=JSON.stringify([...backend.docs]);
 // Another device publishes a new root over a different unreadable generation.
 const unreadableId='another-unreadable-generation',header=backend.docs.get(activePath);
 backend.docs.set('users/owner/generations/'+unreadableId,{...header});
 backend.docs.set('users/owner',{...originalRoot,rev:originalRoot.rev+1,activeGeneration:unreadableId,previousGeneration:originalRoot.previousGeneration});
 const at=reads.length;shim.window.dispatchEvent(new ctx.CustomEvent('cloudboardchange',{detail:{user:backend.CS.user,rev:originalRoot.rev+1}}));
 const priorChunks='users/owner/generations/'+originalRoot.previousGeneration+'/chunks';
 await fixtureDeadline(async wait=>{while(!reads.slice(at).includes(priorChunks)||!recoveryWaitIdle2228(ctx))await wait(10);},'the changed generation is evaluated',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.ok(reads.slice(at).includes('users/owner/generations/'+unreadableId+'/chunks'),'the changed generation is read afresh');
 assert.equal(backend.CS.errorCode,'corrupt-generation');
 assert.equal(syncStatus2200(shim).text,'☁ recovery waiting','it waits again, on the new generation');
 // A readable new generation ends the wait and ordinary sync resumes.
 const healthyPayload=ctx.cloudPayload(),healthy=await ctx.window.ChainStorageV2.encodeSnapshot(healthyPayload),healthyId='healthy-peer-after-wait';
 backend.docs.set('users/owner/generations/'+healthyId,{...healthy,state:'published',baseRev:originalRoot.rev+1});
 for(const chunk of healthy.chunks)backend.docs.set('users/owner/generations/'+healthyId+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 backend.docs.set('users/owner',{...originalRoot,rev:originalRoot.rev+2,activeGeneration:healthyId,previousGeneration:unreadableId});
 shim.window.dispatchEvent(new ctx.CustomEvent('cloudboardchange',{detail:{user:backend.CS.user,rev:originalRoot.rev+2}}));
 await fixtureDeadline(async wait=>{while(ctx.state.syncRev<originalRoot.rev+2||ctx.state.syncDirty)await wait(10);},'the readable generation ends the wait');
 assert.notEqual(syncStatus2200(shim).text,'☁ recovery waiting');
 assert.ok(ctx.state.tasks.some(task=>task.title==='Newer local edit before reconciliation'),'the accepted board is kept');
 assert.notEqual(JSON.stringify([...backend.docs]),cloudBefore,'ordinary sync resumes');
});
// #2228 review: the work budget is a phone-safety limit, and these tests move
// it through window.CLOUD_RECOVERY_WORK_BUDGET_BYTES. The deployed app must
// ignore that value whatever a page script sets. The captured shape is within
// the product budget, so on the deployed Stable page the recovery default runs
// even though the override asks every recovery to wait.
test('RISK recovery wait: the deployed app ignores a page script that sets the work-budget override, so a recovery within the product budget still runs',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim}=app;
 ctx.window.location=new URL('https://emerald-pham.github.io/funsidething/');
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=0;
 // Publication is refused, so the recovery default's outcome stays visible.
 refuseNextRecoveryTransaction255(app.faults);
 ctx.closeModal();await flush();await ctx.cloudPull();await recoveryWaitSettle2228(ctx,'the opening settles');
 assert.notEqual(syncStatus2200(shim).text,'☁ recovery waiting','the override does not make the deployed app wait');
 assert.ok(ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation'),'the recovery default runs within the product budget');
 assert.equal(syncStatus2200(shim).text,'☁ older copy in use');
});
// #2228 review: Retry sync's pull takes the deliberate request before its
// cloud read. A pull that then waits for Settings, opened during that read or
// while recovery lets the board's next frame go first (#2226), is replayed
// when Settings closes and must still run recovery deliberately.
test('RISK recovery wait: a Retry sync that waits for Settings opened during its read or the board frame still runs recovery deliberately when Settings closes',{timeout:300000},async t=>{
 for(const moment of ['during the cloud read','while the board frame goes first'])await t.test(moment,{timeout:150000},async sub=>{
  const app=await capturedGenerationAcceptedApp2198(sub),{ctx,shim}=app;
  ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=RECOVERY_WAIT_BUDGET_2228;
  sub.after(faithfulModalQuery2194(shim));
  const PRIOR='Saved only in the intact prior generation';
  ctx.closeModal();await flush();await ctx.cloudPull();await recoveryWaitSettle2228(ctx,'the opening settles');
  assert.equal(syncStatus2200(shim).text,'☁ recovery waiting','positive control: recovery waits');
  // Publication is refused, so the deliberate run's outcome stays visible.
  refuseNextRecoveryTransaction255(app.faults);
  let opened=false;
  if(moment==='during the cloud read')app.faults.serverRead=async path=>{if(!opened&&path==='users/owner'){opened=true;ctx.openSettings();}};
  // Only the wait that lets the board's next frame go first asks the page for
  // a frame. The harness's timers do not hold the process open, so this does.
  else{
   ctx.window.requestAnimationFrame=callback=>{if(!opened&&vm.runInContext('pulling',ctx)){opened=true;ctx.openSettings();}setTimeout(callback,0);return 1;};
   const alive=setInterval(()=>{},20);sub.after(()=>clearInterval(alive));
  }
  sub.after(()=>{delete app.faults.serverRead;delete ctx.window.requestAnimationFrame;});
  await ctx.onAction('sync-retry',{});await recoveryWaitSettle2228(ctx,'the Retry pull settles');
  assert.equal(opened,true,'Settings opened '+moment);
  assert.equal(vm.runInContext('deferredCloudPull',ctx),true,'the Retry pull waits for Settings to close');
  assert.equal(ctx.state.tasks.some(task=>task.title===PRIOR),false,'nothing runs while Settings is open');
  ctx.closeModal();await flush();await recoveryWaitSettle2228(ctx,'the replayed pull settles');
  assert.ok(ctx.state.tasks.some(task=>task.title===PRIOR),'closing Settings runs the recovery default deliberately');
  assert.equal(syncStatus2200(shim).text,'☁ older copy in use','the wait has ended');
 });
});

// #2194 review M1: a pull that fails before any server root is read (offline,
// timeout, network, permission, interrupted) is no evidence about the source,
// so it must not cost the completed refusal kept in device storage.
test('RISK corrupt cloud work budget: a transient pull failure keeps the completed refusal and the next pull over the unchanged root downloads nothing',{timeout:300000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{priorVariant:'ambiguous legacy rating'}),{ctx,shim,backend,activePath,priorPath}=app;
 const reads=[];let failRoot=null;
 app.faults.serverRead=async path=>{reads.push(path);if(failRoot&&path==='users/owner'){const code=failRoot;failRoot=null;throw Object.assign(Error('Synthetic transient root failure'),{code});}};
 t.after(()=>{delete app.faults.serverRead;});
 const key='fvp:chain-scanner:proved-unreadable-cloud-source';
 const settled=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 const settle=message=>fixtureDeadline(async wait=>{await wait(5);while(!settled())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);
 const generationReads=since=>reads.slice(since).filter(path=>path.startsWith(activePath)||path.startsWith(priorPath));
 const cloudBefore=JSON.stringify([...backend.docs]);
 ctx.closeModal();await flush();await ctx.cloudPull();await settle('the first opening settles');
 const recorded=shim.localStorage.getItem(key);
 assert.ok(recorded,'positive control: the completed refusal is recorded on the device');
 assert.ok(generationReads(0).includes(activePath+'/chunks'),'positive control: the first opening proves the source');
 for(const code of ['unavailable','permission-denied','deadline-exceeded']){
  failRoot=code;let at=reads.length;await ctx.cloudPull();await settle('the '+code+' pull settles');
  assert.equal(failRoot,null,'the '+code+' failure was injected on the root read');
  const kept=shim.localStorage.getItem(key);
  at=reads.length;await ctx.cloudPull();await settle('the pull after '+code+' settles');
  assert.equal(backend.CS.errorCode,'corrupt-generation','the next pull still reports the unreadable generation');
  assert.deepEqual(generationReads(at).filter(path=>path.endsWith('/chunks')),[],'after a '+code+' failure the next pull over the unchanged root makes no chunk read');
  assert.deepEqual(generationReads(at),[],'after a '+code+' failure the next pull over the unchanged root makes no header read');
  assert.equal(kept,recorded,'a '+code+' pull failure keeps the completed refusal on the device');
 }
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected');
 // Retry still proves the source again: the kept refusal is not permanent.
 const beforeRetry=reads.length;await ctx.onAction('sync-retry',{});await settle('Retry settles');
 assert.ok(generationReads(beforeRetry).includes(activePath+'/chunks'),'explicit Retry downloads and checks the unreadable generation again');
});

test('RISK corrupt cloud work budget: an interrupted recovery check is not remembered and the next opening checks again',{timeout:180000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{priorVariant:'ambiguous legacy rating',recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim,backend,activePath,priorPath}=app,store=ctx.window.ScannerDeviceStore;
 const reads=[];let roots=0,interrupted=false;
 // Root reads of the first opening: the bounded pull, the exact-copy check's
 // start and end, then the automatic default's first capture. Its closing root
 // read fails transiently, after the exact-copy check has already completed.
 app.faults.serverRead=async path=>{reads.push(path);
  if(path==='users/owner'&&!interrupted&&++roots===5){interrupted=true;throw Object.assign(Error('Synthetic transient recovery read'),{code:'unavailable'});}};
 t.after(()=>{delete app.faults.serverRead;});
 const chunkReads=since=>reads.slice(since).filter(path=>path===activePath+'/chunks'||path===priorPath+'/chunks');
 const settled=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 const settle=async message=>fixtureDeadline(async wait=>{await wait(5);while(!settled())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);
 const resume=async message=>{shim.document.hidden=true;vm.runInContext('suspendCloudSync()',ctx);shim.document.hidden=false;
  // The resumed pull is not returned: wait for its first server read, then idle.
  const before=reads.length;vm.runInContext('resumeCloudSync({type:"visibilitychange"})',ctx);
  await fixtureDeadline(async wait=>{while(reads.length===before||!settled())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000);};
 const before=JSON.stringify(ctx.state),cloudBefore=JSON.stringify([...backend.docs]);
 ctx.closeModal();await flush();await ctx.cloudPull();await settle('the interrupted opening settles');
 assert.equal(interrupted,true,'the transient failure reached the automatic recovery read');
 assert.equal(JSON.stringify(ctx.state),before);assert.equal(await store.getRecoveryCloudHold(),null);
 assert.equal(JSON.stringify([...backend.docs]),cloudBefore);
 const afterInterrupted=reads.length;await resume('the next opening settles');
 assert.ok(chunkReads(afterInterrupted).includes(priorPath+'/chunks'),'an interrupted check is not a conclusion: the next opening reads the sources again');
 const afterCompleted=reads.length;await resume('a later opening settles');
 assert.deepEqual(reads.slice(afterCompleted),['users/owner'],'once the check completes, a later opening reads only the server root');
 assert.equal(JSON.stringify(ctx.state),before);assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'every cloud source stays protected');
});

test('RISK cloud generation recovery: an unfinished draft survives reconciliation and Undo reverses only the action undone',{timeout:90000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
 refuseNextRecoveryTransaction255(app.faults);
 shim.document.getElementById('addInput').value='Unfinished draft kept through reconciliation';
 ctx.closeModal();await flush();await ctx.cloudPull();
 assert.ok((await store.getRecoveryCloudHold())?.automaticRecovery,'the automatic default applies with an unchanged unfinished draft');
 assert.equal(shim.document.getElementById('addInput').value,'Unfinished draft kept through reconciliation','the unfinished draft remains');
 const reconciled=ctx.state.tasks.map(task=>task.title);
 assert.ok(reconciled.includes('Saved only in the intact prior generation'));
 await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 assert.ok(ctx.state.tasks.some(task=>task.title==='Unfinished draft kept through reconciliation'));
 assert.equal(await ctx.onAction('undo',{}),true);assert.equal(await ctx.persist(),true);
 assert.deepEqual(ctx.state.tasks.map(task=>task.title),reconciled,'Undo removes only the later Add and never reverses the reconciliation');
});
test('RISK cloud generation recovery status: while the automatic recovery default uses the older complete generation, the sync status claims no cloud acknowledgement and says the damaged generation was not recovered',{timeout:120000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim,backend,originalRoot}=app;
 let duringPublication=null;
 app.faults.beforeTransaction=()=>{
  const hold=ctx.window.ScannerDeviceRecoveryHold;
  if(duringPublication||hold?.reason!=='cloud-source-recovery'||hold.automaticRecovery!==true)return;
  duringPublication={...syncStatus2200(shim),dirty:ctx.state.syncDirty,rev:backend.docs.get('users/owner').rev,
   olderOnly:ctx.state.tasks.some(task=>task.title==='Saved only in the intact prior generation')};
 };
 ctx.closeModal();await flush();
 const pull=ctx.cloudPull();let pulled=false;pull.then(()=>{pulled=true;});
 await fixtureDeadline(async wait=>{while(!duringPublication&&!pulled)await wait(20);},'the automatic recovery default reaches its publication',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.ok(duringPublication,'the automatic recovery default commits and starts its guarded publication');
 assert.equal(duringPublication.olderOnly,true,'the older complete generation supplies the working board');
 assert.equal(duringPublication.dirty,true,'reading the older complete generation is not a cloud acknowledgement');
 assert.equal(duringPublication.rev,originalRoot.rev,'no cloud write has acknowledged the current saved board yet');
 const status=duringPublication;
 assert.equal(status.hidden,false);
 assert.equal(status.text,'☁ older copy in use','the sync status names the older complete source; it is neither opening, synced nor an error: '+JSON.stringify(status));
 assert.match(status.title,/older complete copy of your board is in use/i,'the status says an older complete source is in use');
 assert.match(status.title,/cloud saving is not confirmed/i,'the status says cloud saving is not confirmed');
 assert.match(status.title,/damaged newer cloud copy was not recovered/i,'the status says the damaged generation\'s missing data was not recovered');
 assert.doesNotMatch(status.text+' '+status.title,/\bsynced\b|repaired|fixed|restored/i,'the status never reads as synced or repaired');
 assert.doesNotMatch(status.className,/\bok\b/,'the status is never painted as success');
});

test('RISK cloud generation recovery status: genuine device and cloud errors stay visible over the older complete source status',{timeout:120000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
 let olderSource=null,deviceFailure=null;
 app.faults.beforeTransaction=async()=>{
  const hold=ctx.window.ScannerDeviceRecoveryHold;
  if(olderSource||hold?.reason!=='cloud-source-recovery'||hold.automaticRecovery!==true)return;
  olderSource=syncStatus2200(shim);
  // #2194 review F5: opening keeps its own pending style. This is the real
  // renderSync branch while the board has not hydrated and the cloud read is
  // still running, as at boot.
  olderSource.opening=JSON.parse(vm.runInContext('(()=>{const board=state,status=window.CloudSync.status;state=null;window.CloudSync.status="syncing";try{renderSync();const b=document.getElementById("syncBtn");return JSON.stringify({text:b.textContent,className:b.className,disabled:b.disabled});}finally{state=board;window.CloudSync.status=status;renderSync();}})()',ctx));
  // A real device write failure (the storage boundary) while that older copy is in use.
  const commitHead=store.commitHead;store.commitHead=async()=>({ok:false,code:'write-failed'});
  try{shim.document.getElementById('addInput').value='Edit the device could not save';await ctx.onAction('add',{});
   assert.equal(await ctx.persist(),false,'the device write really fails');deviceFailure=syncStatus2200(shim);}
  finally{store.commitHead=commitHead;}
  // The guarded publication itself is then refused by the cloud.
  throw Object.assign(Error('Controlled publication refusal'),{code:'permission-denied'});
 };
 ctx.closeModal();await flush();
 const pull=ctx.cloudPull();let pulled=false;pull.then(()=>{pulled=true;});
 await fixtureDeadline(async wait=>{while(!pulled)await wait(20);},'the refused automatic publication settles',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.equal(olderSource?.text,'☁ older copy in use','positive control: the older complete source status was showing first');
 // #2194 review F5: the three states keep their own existing styles; only a genuine error uses err.
 assert.deepEqual(olderSource.className.split(/\s+/).sort(),['busy','syncbtn'],'an older complete source in use is pending, not an error: '+olderSource.className);
 assert.deepEqual(olderSource.opening,{text:'☁ syncing',className:'syncbtn busy',disabled:true},'opening keeps its pending style');
 assert.equal(deviceFailure.text,'☁ save error','a device save failure is not hidden by the older-source status: '+JSON.stringify(deviceFailure));
 assert.match(deviceFailure.title,/latest edit is not saved on this device/i);
 assert.match(deviceFailure.className,/\berr\b/,'a genuine device save error keeps the error style');
 assert.equal(await ctx.persist(),true,'the device saves again once storage recovers');
 assert.ok(await store.getRecoveryCloudHold(),'no cloud acknowledgement has cleared the older complete source');
 // The cloud then refuses this account outright: a genuine cloud error.
 const refusal=Object.assign(Error('Controlled cloud refusal'),{code:'permission-denied'});
 app.faults.push=refusal;app.faults.pull=refusal;t.after(()=>{delete app.faults.push;delete app.faults.pull;});
 const refused=ctx.cloudPull();let settled=false;refused.then(()=>{settled=true;});
 await fixtureDeadline(async wait=>{while(!settled||vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx))await wait(20);},'the refused cloud attempt settles',CAPTURED_RESULT_BUDGET_MS+20000);
 const cloudError=syncStatus2200(shim);
 assert.equal(ctx.window.CloudSync.errorCode,'permission-denied','the refusal is a real cloud error');
 assert.equal(cloudError.text,'☁ error','a genuine cloud error is not replaced by the older-source status: '+JSON.stringify(cloudError));
 assert.match(cloudError.className,/\berr\b/,'a genuine cloud error keeps the error style');
 assert.match(cloudError.title,/permission denied/i);
 assert.ok(await store.getRecoveryCloudHold(),'the recovery hold and its warning stay in place after the error');
});

test('RISK cloud generation recovery status: Settings says the older complete source is in use and keeps cloud recovery review and deliberate Restore',{timeout:120000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
 refuseNextRecoveryTransaction255(app.faults);
 ctx.closeModal();await flush();
 const pull=ctx.cloudPull();let pulled=false;pull.then(()=>{pulled=true;});
 await fixtureDeadline(async wait=>{while(!pulled)await wait(20);},'the unconfirmed automatic recovery default settles',CAPTURED_RESULT_BUDGET_MS+20000);
 assert.ok((await store.getRecoveryCloudHold())?.automaticRecovery,'the automatic recovery default is in use without a cloud acknowledgement');
 assert.equal(ctx.state.syncDirty,true);
 ctx.openSettings();
 const settings=shim.document.getElementById('modalRoot').innerHTML;
 assert.match(settings,/Cloud recovery is pending/,'the existing recovery warning stays visible');
 assert.match(settings,/has not been confirmed by cloud/);
 assert.match(settings,/older complete copy of your board is in use/i,'Settings names the older complete source in use: '+settings.slice(0,1200));
 assert.match(settings,/damaged newer cloud copy was not recovered/i,'Settings says the damaged generation\'s missing data was not recovered');
 assert.doesNotMatch(settings,/The current board is confirmed by cloud|repaired/i,'Settings never claims a cloud acknowledgement or a repair');
 assert.match(settings,/data-act="review-cloud-source-recovery"/,'cloud recovery review stays reachable');
 assert.match(settings,/data-act="restore-backup"/,'deliberate File or Paste Restore stays reachable');
});

test('RISK cloud generation recovery status: only a real cloud acknowledgement of the current saved board ends the older complete source status',{timeout:240000},async t=>{
 const app=await capturedGenerationAcceptedApp2198(t,{recoveryTimeoutMs:CAPTURED_RESULT_BUDGET_MS}),{ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 const seen=[];
 app.faults.beforeTransaction=()=>{if(ctx.window.ScannerDeviceRecoveryHold?.automaticRecovery)seen.push({...syncStatus2200(shim),rev:backend.docs.get('users/owner').rev});};
 ctx.closeModal();await flush();
 const idle=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 for(let attempt=0;attempt<3&&(attempt===0||ctx.state.syncDirty||vm.runInContext('!!deviceRecoveryCloudHold',ctx));attempt++){
  const pull=ctx.cloudPull();
  await fixtureDeadline(async wait=>{let done=false;pull.then(()=>{done=true;});while(!done||!idle())await wait(20);},
   'the automatic default read settles',CAPTURED_RESULT_BUDGET_MS+20000);
 }
 assert.ok(seen.length>0,'the older complete source was in use before publication');
 // Every observation is taken while the automatic hold is still unconfirmed on this device.
 for(const status of seen)assert.notEqual(status.text,'☁ synced','a board still held for cloud confirmation is never labelled synced: '+JSON.stringify(seen));
 assert.equal(seen[0].rev,originalRoot.rev,'the first observation precedes every cloud write');
 assert.equal(seen[0].text,'☁ older copy in use');
 assert.equal(ctx.state.syncDirty,false,'the automatic default reached a real cloud acknowledgement');
 assert.equal(await store.getRecoveryCloudHold(),null);
 assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev+1,'the acknowledgement is the guarded next revision');
 assert.equal((await backend.CS.pull()).payload,ctx.cloudPayload(),'the cloud now holds exactly the current saved board');
 ctx.renderSync();const after=syncStatus2200(shim);
 assert.equal(after.text,'☁ synced','after the real acknowledgement the board may be called synced');
 assert.doesNotMatch(after.title,/older complete copy/i);
});

test('RISK night shows: launches lead to bounded fading bursts and the festival sails fully on and off screen',()=>{
 const ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);
 for(const [w,h] of [[320,568],[568,320],[768,1024],[1440,900]]){
  const g=ctx.LandscapeGeometry.create(w,h),event={type:'festival',age:0,duration:150,seed:.4};
  assert.equal(typeof g.festival,'function','festival lifecycle geometry exists');
  for(const reverse of [false,true]){
   const enter=g.festival({...event,reverse}),leave=g.festival({...event,age:150,reverse});
   assert.ok(reverse?enter.x-enter.width>w:enter.x+enter.width<0,'entire barge and lighting start offscreen');
   assert.ok(reverse?leave.x+leave.width<0:leave.x-leave.width>w,'entire barge and lighting exit offscreen');
   const mid=g.festival({...event,age:75,reverse});assert.ok(Math.abs(mid.x-w/2)<1e-6);assert.ok(mid.y>g.waterTop&&mid.y+mid.hullDepth<g.far(mid.x));
  }
  assert.ok(g.fireworks(.4,.4).some(dot=>dot.kind==='rocket'),'shells visibly rise from the waterfront');
  for(const festival of [false,true]){
   const end=150;
   assert.equal(g.fireworks(0,.4,festival,event).length,0);assert.equal(g.fireworks(end,.4,festival,event).length,0);
   let reflected=false,burst=false;
   for(let age=0;age<=end;age+=.1){
    const dots=g.fireworks(age,.4,festival,event);assert.ok(dots.length<=320,'paired shells and finale share a fixed bounded particle budget');
    for(const dot of dots){
     for(const n of [dot.x,dot.y,dot.tailX,dot.tailY,dot.alpha])assert.ok(Number.isFinite(n));
     assert.ok(dot.x>=-128&&dot.x<=w+128&&dot.y>=0&&dot.y<=g.waterTop+12);
     assert.ok(dot.alpha>=0&&dot.alpha<=1);
     if(dot.kind==='spark'){burst=true;const y=g.reflectionSurface(1).mirrorY(dot.y);if(y<g.far(dot.x)-1&&y>g.waterTop)reflected=true;}
    }
   }
   assert.ok(burst);assert.ok(reflected,`${w}x${h}: actual burst sparks reach visible lake geometry`);
  }
 }
});

test('RISK fireworks minute schedule: capped visible events preserve seeded opportunity spacing and UTC late join reload across midnight',()=>{
 const current=sceneTimeline(),released=vm.createContext({Math,Date,console});
 for(const file of ['landscape-config.js','vendor/astronomy.min.js','stars.js','landscape-core.js','landscape-geometry.js','landscape-timeline.js'])vm.runInContext(spawnSync('git',['show','4d495cd58d9c6cc6f7d0bcb3812b7027a266d36a:'+file],{cwd:__dirname,encoding:'utf8'}).stdout,released);
 const options={seed:'minute-cap-boundary',sunAt:()=>({altitude:-20,azimuth:0})},a=current.LandscapeTimeline.create(options),old=released.LandscapeTimeline.create(options),b=current.LandscapeTimeline.create(options);
 let found=0;
 for(let second=86200;second<87200;second++){
  const oldShows=old.at(second*1000).events.filter(e=>e.type==='fireworks'),now=a.at(second*1000);
  assert.equal(JSON.stringify(now),JSON.stringify(b.at(second*1000)),'late join and reload use the same immutable UTC scene');
  for(const show of now.events.filter(e=>e.type==='fireworks')){found++;assert.ok(show.duration<=60);assert.ok(oldShows.some(e=>e.id===show.id&&e.start===show.start),'shortening display cannot resample its launch schedule');}
  for(const show of oldShows.filter(e=>e.age>=60))assert.ok(!now.events.some(e=>e.id===show.id),'old tails no longer retain a standalone show');
 }
 assert.ok(found>0,'exercise real midnight-adjacent shows');
 const help=html.slice(html.indexOf('function openHelp'),html.indexOf('function openInstallHelp'));
 assert.match(help,/Sunrise, sunset and nighttime can show fireworks/i);assert.match(help,/Reduced motion keeps scenery still/i);
});

test('RISK motion review harness: frozen actual actor painters reconstruct repeatable before-after sequences across direction viewport and reduced motion',async()=>{
 const {readMotionBuild,createMotionProbe,writeMotionReview}=await import('../scripts/motion-review-harness.mjs');
 const before=readMotionBuild(__dirname,'22d039b2c27019badbb4cc9c92ebf03f5e8c4f6c'),after=readMotionBuild(__dirname,'WORKTREE');
 assert.notEqual(before.sourcesHash,after.sourcesHash);
 for(const [width,height] of [[390,844],[844,390],[820,1180],[1440,900]]){
  const probe=createMotionProbe(after,{width,height});
  for(const actor of ['walker','dogwalker','deer','rabbit','reader','couple','picnic','kite','snowman','snowangel','woodland:deer','woodland:fox','woodland:rabbit','woodland:raccoon'])for(const reverse of [false,true]){
   const options={actor,reverse,progress:.9,seed:.4,lane:.5,zoom:6};
   const first=probe.sample(options),again=probe.sample(options);assert.deepEqual(first,again,'same frozen painter inputs must produce the same command sequence');
   assert.ok(first.commands.length>20);assert.ok(first.commands.every(c=>c.every(v=>typeof v!=='number'||Number.isFinite(v))),'actual canvas commands stay finite');
   assert.deepEqual(probe.sample({...options,reduced:true,progress:.1}),probe.sample({...options,reduced:true,progress:.9}),'reduced motion holds the real midpoint pose');
  }
 }
 const dir=fs.mkdtempSync('/tmp/chain-motion-harness-test-');try{
  const artifact=writeMotionReview({repository:__dirname,beforeRef:before.ref,afterRef:'WORKTREE',outputDir:dir});
  assert.ok(fs.existsSync(artifact.htmlPath));assert.ok(fs.existsSync(artifact.manifestPath));
  const html=fs.readFileSync(artifact.htmlPath,'utf8');assert.ok(html.includes('motionHarness')&&html.includes('captureSequence')&&html.includes('Playback speed'));assert.ok(!html.includes('localStorage'),'fixture never touches saved boards');
  const outer=html.match(/<script>([\s\S]*)<\/script>/)[1];new vm.Script(outer);
  const pages=JSON.parse(outer.match(/,pages=(.*);document.getElementById/)[1]);for(const page of pages)new vm.Script(page.match(/<script>([\s\S]*)<\/script>/)[1]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('RISK immutable scenery fixture preparation: exact source reuse keeps fresh consumer contexts and known output',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs');
 const marker='ci266-'+process.pid+'-'+Date.now(),stateKey='__ci266FixtureState'+process.pid,compiled=[],contexts=[];
 const runDescriptor=Object.getOwnPropertyDescriptor(vm,'runInContext'),scriptDescriptor=Object.getOwnPropertyDescriptor(vm,'Script'),contextDescriptor=Object.getOwnPropertyDescriptor(vm,'createContext');
 const observe=source=>{if(typeof source==='string'&&source.includes(marker))compiled.push(source);};
 vm.runInContext=function(source,...args){observe(source);return Reflect.apply(runDescriptor.value,this,[source,...args]);};
 vm.Script=new Proxy(scriptDescriptor.value,{construct(target,args){observe(args[0]);return Reflect.construct(target,args,target);}});
 vm.createContext=function(...args){const context=Reflect.apply(contextDescriptor.value,this,args);contexts.push(context);return context;};
 try{
  const sceneFiles=['landscape-config.js','vendor/astronomy.min.js','stars.js','landscape-core.js','landscape-geometry.js','landscape-visits.js','landscape-timeline.js'];
  const annotate=(source,label)=>source+'\n/*'+marker+':'+label+' */'+(label.endsWith('landscape-config.js')?'\nglobalThis['+JSON.stringify(stateKey)+']=(globalThis['+JSON.stringify(stateKey)+' ]||0)+1;':'');
  const sceneTransforms=Object.fromEntries(sceneFiles.map(file=>[file,source=>annotate(source,'scene:'+file)]));
  const sceneStart=compiled.length,contextStart=contexts.length,sceneA=sceneTimeline(sceneTransforms),sceneAfterA=compiled.length;
  assert.equal(sceneAfterA-sceneStart,7,'first real scene consumer compiles each exact source once');
  const sceneB=sceneTimeline(sceneTransforms),sceneAfterB=compiled.length;
  assert.equal(sceneAfterB-sceneAfterA,0,'repeat real scene consumer reuses immutable compiled source');
  assert.notStrictEqual(contexts[contextStart],contexts[contextStart+1],'scene module bytecode executes in fresh mutable contexts');
  assert.equal(contexts[contextStart][stateKey],1);assert.equal(contexts[contextStart+1][stateKey],1,'module globals start fresh even when bytecode is reused');
  const clock=Date.parse('2026-10-06T03:23:42.125Z'),sceneOptions={seed:'ci266-known-scene',season:'summer',sunAt:()=>({altitude:-20,azimuth:0})};
  const sceneAt=context=>JSON.parse(JSON.stringify(context.LandscapeTimeline.create(sceneOptions).at(clock)));
  const sceneExpected=sceneAt(sceneTimeline());
  assert.deepEqual(sceneAt(sceneA),sceneExpected,'comment-only source keys preserve the independent known scene');
  assert.deepEqual(sceneAt(sceneB),sceneExpected,'cached scene module output matches the independent known scene');
  const changedSceneTransforms={...sceneTransforms,'stars.js':source=>sceneTransforms['stars.js'](source)+'\n/*'+marker+':changed-stars-source */'};
  const sceneBeforeChange=compiled.length,sceneChanged=sceneTimeline(changedSceneTransforms);
  assert.equal(compiled.length-sceneBeforeChange,1,'one changed exact scene source causes one compilation');
  assert.equal(contexts[contextStart+3][stateKey],1,'the changed-source scene also receives fresh module state');
  assert.deepEqual(sceneAt(sceneChanged),sceneExpected,'a changed comment-only source retains the exact scene outcome');

  const build=readMotionBuild(__dirname,'WORKTREE'),sources=Object.fromEntries(Object.entries(build.sources).map(([file,source])=>[file,annotate(source,'motion:'+file)]));
  sources['landscape.js']=sources['landscape.js'].replace('  function person(','  function person(/*'+marker+':motion:painter */');
  const markedBuild={...build,sources},sampleOptions={actor:'walker',progress:.5,duration:100,seed:.4,lane:.5,zoom:1};
  const reference=createMotionProbe(build,{width:390,height:844}).sample(sampleOptions);
  const motionStart=compiled.length,motionContextStart=contexts.length;
  const first=createMotionProbe(markedBuild,{width:390,height:844}).sample(sampleOptions),motionAfterFirst=compiled.length;
  assert.equal(motionAfterFirst-motionStart,8,'first actual painter consumer compiles seven modules and its painter');
  const second=createMotionProbe(markedBuild,{width:390,height:844}).sample(sampleOptions);
  assert.equal(compiled.length-motionAfterFirst,0,'repeat actual painter consumer reuses immutable compiled source');
  assert.notStrictEqual(contexts[motionContextStart],contexts[motionContextStart+1],'painter bytecode executes in fresh mutable contexts');
  assert.equal(contexts[motionContextStart][stateKey],1);assert.equal(contexts[motionContextStart+1][stateKey],1,'painter module globals start fresh on every probe');
  assert.deepEqual(first,reference,'instrumented source produces the independent actual painter output');
  assert.deepEqual(second,reference,'compiled reuse retains every actual painter command and metadata');
  const changedSources={...sources,'landscape-geometry.js':sources['landscape-geometry.js']+'\n/*'+marker+':changed-geometry-source */'},changedBuild={...markedBuild,sources:changedSources};
  assert.equal(changedBuild.sourcesHash,markedBuild.sourcesHash,'fixture retains a deliberately stale aggregate hash to discriminate exact source keys');
  const motionBeforeChange=compiled.length,third=createMotionProbe(changedBuild,{width:390,height:844}).sample(sampleOptions);
  assert.equal(compiled.length-motionBeforeChange,1,'one changed exact painter module source causes one compilation despite the same aggregate hash');
  assert.equal(contexts[motionContextStart+2][stateKey],1,'changed-source painter still receives fresh module state');
  assert.deepEqual(third,reference,'the changed comment-only module preserves the independent actual painter output');
 }finally{
  Object.defineProperty(vm,'runInContext',runDescriptor);Object.defineProperty(vm,'Script',scriptDescriptor);Object.defineProperty(vm,'createContext',contextDescriptor);
 }
});


// A staged finale must be observable through emitted shells, not scheduling metadata.
test('RISK fireworks crescendo: finale emits distinct overlapping volleys and a wider closing crown',()=>{
 const context=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),context);
 for(const [width,height] of [[390,844],[768,1024],[1440,900],[568,320]])for(const festival of [false,true]){
 const duration=festival?150:60,g=context.LandscapeGeometry.create(width,height),event={duration,seed:.4},starts=new Map();
 let overlap=false,peak=0;
 for(let step=1;step<duration*50;step++){
  const age=step/50,dots=g.fireworks(age,.4,festival,event),finale=dots.filter(d=>d.finale);
  peak=Math.max(peak,dots.length);
  for(const dot of finale)if(!starts.has(dot.burst))starts.set(dot.burst,{age,x:dot.x});
  if(finale.some(d=>d.kind==='rocket')&&finale.some(d=>d.kind==='spark'))overlap=true;
 }
 const groups=new Map();for(const shell of starts.values()){const key=shell.age.toFixed(2);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(shell.x);}
 const volleys=[...groups.values()];
 assert.ok(volleys.length>=3,'a real crescendo needs at least three distinct ignition times; current single eight-shell volley cannot satisfy it');
 assert.ok(overlap,'later finale ascents overlap earlier blooms');
 assert.ok(volleys.at(-1).length>volleys[0].length,'closing crown fires more shells than the opening volley');
 const span=xs=>Math.max(...xs)-Math.min(...xs);
 assert.ok(span(volleys.at(-1))>span(volleys[0]),'closing crown expands sky coverage');
 assert.ok(peak<=320,'overlapping choreography retains the existing active particle cap');
 assert.equal(g.fireworks(duration,.4,festival,event).length,0,'all tails finish within the standalone cap or barge crossing');
 }
});


test('RISK seeded trigger admissions: actual UTC rail consumer admits chance gaps with preserved mean and track capacity',()=>{
 const c=sceneTimeline(),T=c.LandscapeTimeline,C=c.LandscapeConfig,seed='chance-rails',options={seed,sunAt:()=>({altitude:-20,azimuth:0})};
 const a=T.create(options),b=T.create(options);
 for(const type of ['train','metro']){
  const maximum=C.rail[type].duration/.82,interval=Math.ceil(maximum*1000)/1000,period=maximum+C.rail[type].gap/C.spawnRate(type),chance=interval/period;let admitted=0;
  for(let slot=20000;slot<20512;slot++){
   const at=Math.ceil(slot*interval*1000)+1,expected=T.sample(seed,`${type}-admission`,slot)<chance;
   const scene=a.at(at),match=scene.events.find(e=>e.id===`${type}:${slot}`);
   assert.equal(!!match,expected,`${type} slot ${slot}: actual admission must follow the seeded roll, including rejected opportunities`);
   assert.ok(scene.events.filter(e=>e.type===type).length<=1,'one vehicle per track');
   assert.deepEqual(JSON.parse(JSON.stringify(scene)),JSON.parse(JSON.stringify(b.at(at))),'fresh/reloaded consumer agrees');
   if(match)admitted++;
  }
  assert.ok(admitted>512*(chance-.06)&&admitted<512*(chance+.06),'bounded sample retains expected average frequency');
 }
 C.setSpawnRates('| train | 0 |\n| metro | 0 |');
 assert.ok(!T.create(options).at(1585366000).events.some(e=>['train','metro'].includes(e.type)),'zero rates disable both tracks');
});

test('RISK pedestrian complete parties: scheduled walking routes clear both edges at bounded pace and paint without terminal fade',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE');
 const ctx=sceneTimeline();for(const file of ['landscape-winter.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),ctx);
 const durations=ctx.LandscapeConfig.eventDurations;
 for(const [width,height] of [[390,844],[844,390],[820,1180],[1440,900]])for(const reverse of [false,true])for(const type of ['walker','dogwalker','reader','couple','picnic','kite','snowman','snowangel']){
  const geo=ctx.LandscapeGeometry.create(width,height),base={type,duration:durations[type],seed:.4,lane:.5,reverse,speed:1},plan=geo.walkingPlan(base);
  const event={...base,activityDuration:base.duration,duration:ctx.LandscapeGeometry.create(8192,900).walkingLifetime(base)};
  const at=age=>{const e={...event,age};if(['snowman','snowangel'].includes(type)){const p=ctx.LandscapeWinter.pose(type,e,geo,width,height);return {x:type==='snowman'?p.builderX:p.x,alpha:type==='snowman'?p.builderAlpha:p.alpha};}const p=['walker','dogwalker'].includes(type)?geo.groundPose('walker',e):geo.visitPose(e,geo.motionProgress(e,'x'));return {x:p.x,alpha:1};};
  const gone=at(plan.duration);assert.ok(reverse?gone.x<=-80:gone.x>=width+80,`${type} full person/companion party clears edge before logical retirement`);
  for(const fraction of [.25,.5,.75,.98]){
   const age=plan.duration*fraction,a=at(age),b=at(age+.02);if(age>plan.begin+2)assert.ok(Math.abs(b.x-a.x)/.02<=4.3,`${type} exit cannot accelerate for a deadline`);
   if(a.x>0&&a.x<width&&age>base.duration*.15){assert.equal(a.alpha,1,`${type} remains opaque in visible departure`);}
  }
  const age=Math.min(plan.duration-1,Math.max(plan.begin+1,plan.duration*.8)),frame=createMotionProbe(build,{width,height}).sample({actor:type,event:{...event,age},zoom:1});assert.ok(frame.commands.length>0,'actual painter executes complete production-shaped visit');
 }
});


test('RISK terrain walking cadence: steep production routes slow travel with reachable contacts across human variants',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE');
 const ctx=vm.createContext({Math});for(const file of ['landscape-geometry.js','landscape-winter.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),ctx);
 for(const type of ['walker','dogwalker','reader','couple','picnic','kite','snowman','snowangel'])for(const reverse of [false,true]){
  const g=ctx.LandscapeGeometry.create(390,844),duration={walker:60,dogwalker:70,reader:220,couple:200,picnic:240,kite:90,snowman:180,snowangel:100}[type];
  const e={type,duration:3000,activityDuration:duration,seed:.4,lane:.5,reverse};
  const pose=age=>{const event={...e,age};return ['snowman','snowangel'].includes(type)?ctx.LandscapeWinter.pose(type,event,g,390,844):['walker','dogwalker'].includes(type)?g.groundPose('walker',event):g.visitPose(event,g.motionProgress(event,'x'));};
  const xpos=p=>type==='snowman'?p.builderX:p.x,target=reverse?150:245;
  let lo=g.walkingPlan(e).begin,hi=g.walkingPlan(e).duration;
  for(let i=0;i<48;i++){const mid=(lo+hi)/2;if((xpos(pose(mid))-target)*(reverse?-1:1)<0)lo=mid;else hi=mid;}
  const age=(lo+hi)/2,a=pose(age),b=pose(age+.001),scale=type==='snowman'?a.builderScale:type==='snowangel'?a.scale:1;
  const ground=g.humanGround(type==='snowman'?'middle':type==='snowangel'?'near':'trail',type==='snowman'?a.snowOffset:type==='snowangel'?a.snowOffset:['walker','dogwalker'].includes(type)?5:20);
  const x=xpos(a),y=ground(x),m=g.humanWalkPose(x,y,a.distance??a.walkDistance,a.direction,ground,0,scale,a.travel);
  const clockDelta=g.walkingClock({...e,age:age+.001})-g.walkingClock({...e,age});
  const cadence=Math.abs(xpos(b)-x)/clockDelta/scale/m.stride;
  assert.ok(cadence<=.64,`${type} reverse=${reverse}: ${cadence.toFixed(3)} cycles per walking-clock second exceeds the half-prior steep-route reference .625`);
  const before=[],after=[],probe=createMotionProbe(build,{width:390,height:844,onHumanPose:pose=>before.push(JSON.parse(JSON.stringify(pose)))});
  probe.sample({actor:type,event:{...e,age},zoom:1});
  createMotionProbe(build,{width:390,height:844,onHumanPose:pose=>after.push(JSON.parse(JSON.stringify(pose)))}).sample({actor:type,event:{...e,age:age+.001},zoom:1});
  assert.ok(before.length>0,'actual human painter must execute');assert.equal(before.length,after.length);
  before.forEach((pose,i)=>{
   const angle=p=>Math.acos(Math.max(-1,Math.min(1,-(p.arms[0].x-p.hipX)/3)));
   const actualCadence=Math.abs(angle(after[i])-angle(pose))/(Math.PI*2*clockDelta);
   assert.ok(actualCadence<=.65,`${type} partner${i}: actual painted limb phase advances ${actualCadence.toFixed(3)} cycles per clock second`);
  });
  const initial=JSON.parse(JSON.stringify(pose(age)));
  for(let lane=0;lane<40;lane++)g.groundPose('walker',{...e,type:'walker',lane:lane/39,age:800});
  assert.deepEqual(JSON.parse(JSON.stringify(pose(age))),initial,'terrain table eviction and reseek reconstruct the same route without frame history');
 }
});


test('RISK terrain walking approach: actual carrying arrivals preserve planted contacts on their full offscreen route',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE');
 for(const actor of ['reader','couple','picnic','kite'])for(const reverse of [false,true])for(const age of [1,3,7,12]){
  const duration={reader:220,couple:200,picnic:240,kite:90}[actor],event={type:actor,age,duration:9000,activityDuration:duration,seed:.4,lane:.5,reverse},samples=[];
  for(const offset of [0,.00001]){const poses=[],frame=createMotionProbe(build,{width:390,height:844,onHumanPose:pose=>poses.push(JSON.parse(JSON.stringify(pose)))}).sample({actor,event:{...event,age:age+offset},zoom:1});samples.push({poses,x:frame.metadata.x});}
  assert.equal(samples[0].poses.length,actor==='couple'||actor==='picnic'?2:1,'actual constrained carrying painter executes every arriving person');
  samples[0].poses.forEach((pose,i)=>{const next=samples[1].poses[i];for(let leg=0;leg<2;leg++)if(pose.legs[leg].lift===0&&next.legs[leg].lift===0)assert.ok(Math.abs(samples[0].x+(reverse?-1:1)*pose.legs[leg].footX-samples[1].x-(reverse?-1:1)*next.legs[leg].footX)<1e-7,'arrival stance toes stay fixed in world coordinates');});
 }
});

// In-scene admission must start people beyond the frame, not at their activity anchor.
test('RISK pedestrian entry: natural carrying and builder visits start opaque outside the frame and walk continuously to activity',()=>{
 const ctx=vm.createContext({Math});for(const file of ['landscape-geometry.js','landscape-winter.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),ctx);
 for(const [width,height] of [[390,844],[844,390],[820,1180],[1440,900]])for(const reverse of [false,true])for(const type of ['walker','dogwalker','reader','couple','picnic','kite','snowman','snowangel']){
  const g=ctx.LandscapeGeometry.create(width,height),duration={walker:60,dogwalker:70,reader:220,couple:200,picnic:240,kite:90,snowman:180,snowangel:100}[type],e={type,duration:9000,activityDuration:duration,age:0,lane:.5,seed:.4,reverse};
  const at=age=>{const event={...e,age};if(type==='snowman'||type==='snowangel'){const p=ctx.LandscapeWinter.pose(type,event,g,width,height);return {x:type==='snowman'?p.builderX:p.x,alpha:type==='snowman'?p.builderAlpha:p.alpha};}return {...(['walker','dogwalker'].includes(type)?g.groundPose('walker',event):g.visitPose(event,g.motionProgress(event,'x'))),alpha:1};};
  const start=at(0),margin=type==='couple'||type==='picnic'?23:type==='dogwalker'?27:12;
  assert.ok(reverse?start.x-margin>width:start.x+margin<0,`${type} ${width} reverse=${reverse}: initial human party x=${start.x} is inside the visible frame`);
  assert.equal(start.alpha,1,'entry is movement, never a person alpha fade');
  let prior=start;
  for(let age=.25;age<=Math.min(g.walkingLifetime(e),1000);age+=.25){const current=at(age);assert.ok((current.x-prior.x)*(reverse?-1:1)>=-1e-7,'arrival/settling/departure never teleports backward');assert.ok(Math.abs(current.x-prior.x)<=4.4*.25+1e-6,'no speed-up or entry snap');if(current.x>0&&current.x<width)assert.equal(current.alpha,1,'visible person stays opaque');prior=current;}
 }
});

test('RISK pedestrian entry contacts: actual carrying pose stays continuous across offscreen approach and settling boundaries',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE'),ctx=vm.createContext({Math});vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),ctx);
 for(const actor of ['reader','couple','picnic','kite'])for(const reverse of [false,true]){
  const g=ctx.LandscapeGeometry.create(390,844),duration={reader:220,couple:200,picnic:240,kite:90}[actor],e={type:actor,duration:9000,activityDuration:duration,seed:.4,lane:.5,reverse},plan=g.walkingPlan(e);
  for(const clock of [plan.arrivalSeconds,plan.arrivalSeconds+duration*.24,plan.begin]){
   let lo=0,hi=g.walkingLifetime(e);for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(g.walkingClock({...e,age:mid})<clock)lo=mid;else hi=mid;}const age=(lo+hi)/2,poses=[];
   for(const ageOffset of [-1e-7,1e-7]){const observed=[];createMotionProbe(build,{width:390,height:844,onHumanPose:p=>observed.push(JSON.parse(JSON.stringify(p)))}).sample({actor,event:{...e,age:age+ageOffset},zoom:1});poses.push(observed);}
   assert.equal(poses[0].length,poses[1].length);poses[0].forEach((a,i)=>{const b=poses[1][i];for(const key of ['hipX','hipY','bob'])assert.ok(Math.abs(a[key]-b[key])<.001,`${actor} ${key} must not snap at entry clock ${clock}`);for(let leg=0;leg<2;leg++)for(const key of ['footX','footY','kneeX','kneeY'])assert.ok(Math.abs(a.legs[leg][key]-b.legs[leg][key])<.001,`${actor} ${key} must not replan at entry clock ${clock}`);});
  }
 }
});

test('RISK pedestrian entry reconstruction: reload resize and seek retain selected visits without an invented startup delay',()=>{
 const base=spawnSync('git',['show','18e3eebaeac3e05d64177c97486d48d1ab1f84eb:landscape-geometry.js'],{cwd:__dirname,encoding:'utf8'});assert.equal(base.status,0);const oldTimeline=spawnSync('git',['show','18e3eebaeac3e05d64177c97486d48d1ab1f84eb:landscape-timeline.js'],{cwd:__dirname,encoding:'utf8'});assert.equal(oldTimeline.status,0);const prior=sceneTimeline({'landscape-geometry.js':()=>base.stdout,'landscape-timeline.js':()=>oldTimeline.stdout}),ctx=sceneTimeline();vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-winter.js'),'utf8'),ctx);
 const facts=e=>({id:e.id,type:e.type,age:e.age,duration:e.activityDuration||e.duration,seed:e.seed,lane:e.lane,reverse:e.reverse,speed:e.speed}),options={seed:'private-entry-reconstruction',season:'winter',sunAt:()=>({altitude:25,azimuth:100})},old=prior.LandscapeTimeline.create(options),current=ctx.LandscapeTimeline.create(options);
 for(const seconds of [0,70,301,900,1801]){const at=Date.parse('2026-10-11T10:00Z')+seconds*1000,a=old.at(at),b=current.at(at),fresh=ctx.LandscapeTimeline.create(options).at(at);assert.deepEqual(JSON.parse(JSON.stringify(b)),JSON.parse(JSON.stringify(fresh)),'fresh reload reconstructs current scene immediately, including ongoing ages');for(const event of b.events.filter(e=>e.age<(e.activityDuration||e.duration))){const original=a.events.find(e=>e.id===event.id);assert.ok(original,'capacity admits a subset of seeded opportunities rather than inventing arrivals');assert.deepEqual(JSON.parse(JSON.stringify(facts(event))),JSON.parse(JSON.stringify(facts(original))),'an admitted opportunity retains its original seeded type, start, speed and geometry inputs');}
  for(const [width,height] of [[390,844],[844,390],[820,1180],[1440,900]])for(const e of b.events.filter(e=>['reader','couple','picnic','kite','snowman','skier'].includes(e.type))){const g=ctx.LandscapeGeometry.create(width,height),h=ctx.LandscapeGeometry.create(width,height),pose=(geo,event)=>['snowman','skier'].includes(e.type)?ctx.LandscapeWinter.pose(e.type,event,geo,width,height):geo.visitPose(event,geo.motionProgress(event,'x'));const expected=JSON.parse(JSON.stringify(pose(g,e)));pose(g,{...e,age:0});pose(g,{...e,age:e.age+100});assert.deepEqual(JSON.parse(JSON.stringify(pose(g,e))),expected,'backward seek is independent of previous frames');assert.deepEqual(JSON.parse(JSON.stringify(pose(h,e))),expected,'resize/fresh geometry at same dimensions reconstructs same current pose');}
 }
});

test('RISK pedestrian planner cold work: full capacity skips unnecessary lifetime solving without changing admitted scenes or reseeks', () => {
 const prior=spawnSync('git',['show','c21ee6f2a1147636f89cc96dae80aa9ba8ba9ea5:landscape-timeline.js'],{cwd:__dirname,encoding:'utf8'});assert.equal(prior.status,0,prior.stderr);
 const epoch=Date.parse('2026-10-06T00:00Z'),day=86400000,snapshot=value=>JSON.parse(JSON.stringify(value));
 for(const season of ['winter','summer'])for(const night of [false,true]){
  const current=sceneTimeline(),reference=sceneTimeline({'landscape-timeline.js':()=>pedestrianDaytimeSpawnPolicy(pedestrianReservationPolicy(prior.stdout))}),create=current.LandscapeGeometry.create;let calls=0;
  current.LandscapeGeometry.create=(w,h)=>{const geometry=create(w,h);if(w===8192){const lifetime=geometry.walkingLifetime;geometry.walkingLifetime=e=>{calls++;return lifetime(e);};}return geometry;};
  for(const c of[current,reference])assert.equal(c.LandscapeConfig.setSpawnRates('| blimp | 0 |'),true);
  const options={seed:'private-schedule',season,sunAt:()=>({altitude:night?-20:30,azimuth:night?0:90})},actual=current.LandscapeTimeline.create(options),baseline=reference.LandscapeTimeline.create(options),first=epoch+12*3600000;
  let historicalNoonQueries=0;const historicalAt=baseline.at;baseline.at=at=>{if(at===first)historicalNoonQueries++;return historicalAt(at);};
  // The pinned historical source and all options are fixed within this scenario.
  // Keep only its repeated noon result; current queries still rebuild after eviction.
  const firstExpected=JSON.stringify(baseline.at(first));
  assert.deepEqual(snapshot(actual.at(first)),JSON.parse(firstExpected),'the actual cold consumer preserves every admitted event, duration and independent scenery stream');
  assert.ok(calls<=(night?1300:season==='winter'?1300:1800),`${season} ${night?'night':'day'} cold planning solved ${calls} lifetimes despite full capacity`);
  const coldCalls=calls;actual.at(first+8000);actual.at(first-8000);actual.at(first);assert.ok(calls<=coldCalls+4,'same-day buckets reuse admission and resolve only newly inspected immutable recipes');
  for(const offset of [1,23*3600000+40*60000,day-1,day,day+1,-1,2*day+1,-2*day+1,12*3600000]){
   const at=epoch+offset,scene=actual.at(at);assert.deepEqual(snapshot(scene),at===first?JSON.parse(firstExpected):snapshot(baseline.at(at)),'midnight, eviction and backwards reseek preserve exact scheduling');assertPedestrianReservationBound(scene);
   for(const e of scene.events)if(!['train','metro'].includes(e.type)){const born=at-e.age*1000;assert.ok(born+Math.max(e.duration,e.scheduleDuration||e.activityDuration||e.duration)*1000<=(Math.floor(born/day)+1)*day+.001,'full reservations still fit their admitted UTC day');}
  }
  assert.equal(historicalNoonQueries,1,'the identical independent historical noon expectation is prepared once per isolated scenario');
 }
});

test('RISK pedestrian planner rare reuse: guard join is unique and complete admitted scenes match prior across rare rates midnight and eviction', () => {
 const released=spawnSync('git',['show','f8fa176ddfaeedb9b2b7aeaf586b8e71a2e5ce3f:landscape-timeline.js'],{cwd:__dirname,encoding:'utf8'});assert.equal(released.status,0,released.stderr);
 const epoch=Date.parse('2026-10-06T00:00Z'),day=86400000,snapshot=value=>JSON.parse(JSON.stringify(value));
 for(const season of ['summer','winter'])for(const night of [false,true])for(const rareRate of [0,2]){
  const actual=sceneTimeline(),prior=sceneTimeline({'landscape-timeline.js':()=>pedestrianDaytimeSpawnPolicy(pedestrianReservationPolicy(released.stdout))});for(const c of[actual,prior])assert.equal(c.LandscapeConfig.setSpawnRates(`| abduction | ${rareRate} |\n| festival | ${rareRate} |\n| blimp | 0 |`),true);
  const options={seed:rareRate?'private-schedule':'chain-scanner-scene-v1',season,sunAt:()=>({altitude:night?-20:30,azimuth:night?0:90})},a=actual.LandscapeTimeline.create(options),b=prior.LandscapeTimeline.create(options),first=epoch+12*3600000;
  let historicalNoonQueries=0;const historicalAt=b.at;b.at=at=>{if(at===first)historicalNoonQueries++;return historicalAt(at);};
  // Serialized data is immutable and belongs only to this source/config/seed scenario.
  const firstExpected=JSON.stringify(b.at(first));
  for(const offset of[12*3600000,-1,0,1,day-1,day,day+1,2*day+1,12*3600000]){const value=a.at(epoch+offset);assert.deepEqual(snapshot(value),epoch+offset===first?JSON.parse(firstExpected):snapshot(b.at(epoch+offset)),'raw reuse retains accepted IDs, lifetimes, independent streams and cache/UTC reconstruction');assertPedestrianReservationBound(value);}
  assert.equal(historicalNoonQueries,1,'rare-rate scenarios prepare their own identical independent historical noon expectation once');
 }
 const boundarySlot=epoch/1000/8-75,inject=source=>source.replace('function random(seed,stream,slot=0){',`function random(seed,stream,slot=0){if(seed==='private-rare-boundary'&&stream==='arrival'&&slot===${boundarySlot})return ()=>0;`).replace('const rare=rareRaw.filter','globalThis.rareIds=rareRaw.map(e=>e.id);const rare=rareRaw.filter');
 const a=sceneTimeline({'landscape-timeline.js':inject}),b=sceneTimeline({'landscape-timeline.js':()=>inject(pedestrianDaytimeSpawnPolicy(pedestrianReservationPolicy(released.stdout)))}),options={seed:'private-rare-boundary',season:'summer',sunAt:()=>({altitude:30,azimuth:90})};
 for(const c of[a,b])assert.equal(c.LandscapeConfig.setSpawnRates('| blimp | 0 |'),true);
 assert.deepEqual(snapshot(a.LandscapeTimeline.create(options).at(epoch+3600000)),snapshot(b.LandscapeTimeline.create(options).at(epoch+3600000)));
 assert.ok(a.rareIds.includes(`arrival:${boundarySlot}`),'fixture puts an actual abduction exactly at the raw/rare guard join');assert.equal(new Set(a.rareIds).size,a.rareIds.length,'inclusive ordinary range endpoints cannot duplicate the join proposal');
 const broken=sceneTimeline({'landscape-timeline.js':source=>inject(source).replace("filter(e=>e.type==='abduction'&&!rareIds.has(e.id))","filter(e=>e.type==='abduction')")});broken.LandscapeTimeline.create(options).at(epoch+3600000);assert.ok(new Set(broken.rareIds).size<broken.rareIds.length,'negative control removing guard-join deduplication must still expose the forced duplicate');
});

test('RISK pedestrian planner solar work: failed show chance draws do not request unused astronomy and exact scenes remain unchanged',()=>{
 const old=spawnSync('git',['show','f8fa176ddfaeedb9b2b7aeaf586b8e71a2e5ce3f:landscape-timeline.js'],{cwd:__dirname,encoding:'utf8'});assert.equal(old.status,0,old.stderr);
 for(const rate of[0,1]){
  const current=sceneTimeline(),prior=sceneTimeline({'landscape-timeline.js':()=>pedestrianDaytimeSpawnPolicy(pedestrianReservationPolicy(old.stdout))}),location={latitude:28.5383,longitude:-81.3792,timezone:'America/New_York',elevation:20},storage={getItem(){return null;}};let calls=0;
  for(const c of[current,prior])assert.equal(c.LandscapeConfig.setSpawnRates(`| fireworks | ${rate} |\n| festival | ${rate} |\n| blimp | 0 |`),true);
  const options=c=>({seed:c.LandscapeTimeline.DEFAULT_SEED,season:'autumn',location,sunAt:at=>{if(c===current)calls++;return c.LivingSky.sunAt(c.LivingSky.sceneDate(new Date(at),storage,location),location);}}),a=current.LandscapeTimeline.create(options(current)),b=prior.LandscapeTimeline.create(options(prior)),at=Date.parse('2026-10-06T12:00Z'),value=a.at(at);
  assert.deepEqual(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(b.at(at))),'pure chance prechecks preserve the actual astronomy-derived admitted scene');
  assert.ok(calls<=(rate?2100:1600),`show rate ${rate} unnecessarily queried ${calls} astronomical instants after already failed chance draws`);
  const count=calls;a.at(at+8000);assert.ok(calls<=count+1,'same-day scheduling retains its bounded sun memo');
 }
});

test('RISK pedestrian slot recovery: departed display recipes cannot suppress an otherwise eligible shared arrival',()=>{
 const c=sceneTimeline(),options={seed:'private-walking-exits',season:'summer',sunAt:()=>({altitude:25,azimuth:100})};
 const at=Date.parse('2026-10-14T01:07:55Z'),timeline=c.LandscapeTimeline.create(options),scene=timeline.at(at);
 assert.ok(scene.events.some(e=>e.id==='arrival:223992509'&&e.type==='hoverboard'),'original-reservation eligible hoverboard must not be blocked by ten departed phone walkers');
 assertPedestrianReservationBound(scene);
 assert.ok(scene.events.some(e=>e.activityDuration&&e.age>e.activityDuration),'complete crossing recipes remain after their admission slot expires');
 for(const [width,height]of [[390,844],[820,1180],[1440,900],[2560,1080],[8192,900]])for(const reduced of [false,true]){
  const fresh=c.LandscapeTimeline.create({...options,width,height,reduced});
  fresh.at(at+86400000);fresh.at(at-86400000);
  assert.deepEqual(JSON.parse(JSON.stringify(fresh.at(at))),JSON.parse(JSON.stringify(scene)),'resize, cold reload and backwards seek retain every shared recipe');
 }
});

test('RISK pedestrian deferred reconstruction: eager recipe reference matches lazy output at lookback midnight and cache eviction',()=>{
 const lazy=sceneTimeline(),eager=sceneTimeline({'landscape-visits.js':source=>source.replace('return visit;','void visit.duration;return visit;').replace('event.start>=from-MAX_VISIT_LIFETIME&&','true&&')});
 const options={seed:'private-walking-exits',season:'winter',sunAt:()=>({altitude:25,azimuth:100})},a=lazy.LandscapeTimeline.create(options),b=eager.LandscapeTimeline.create(options),epoch=Date.parse('2026-10-14T00:00Z'),day=86400000;
 for(const offset of [0,2700000-1,2700000,2700000+1,day-2700000,day-1,day,day+1,2*day+1,-day+1,2700000]){
  const at=epoch+offset,actual=a.at(at);assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(b.at(at))),'getter read order, boundary and cache history cannot change shared output');
  assert.ok(actual.events.every(e=>typeof e.duration==='number'&&Number.isFinite(e.duration)),'published snapshot recipes are plain numeric objects');assertPedestrianReservationBound(actual);
 }
});

test('RISK daytime people: daytime and twilight spawn rate halves while complete visits and night schedules finish intact',()=>{
 const baselineSha='3b273718df28919586c2cd84ca835de573631fe3',baselineSource=spawnSync('git',['show',`${baselineSha}:landscape-timeline.js`],{cwd:__dirname,encoding:'utf8'});
 assert.equal(baselineSource.status,0,`pinned scenery baseline must load: ${baselineSource.stderr}`);
 const people=new Set(['cyclist','walker','dogwalker','reader','picnic','couple','kite','skateboarder','rollerskater','hoverboard','scooter','jetski','windsurfer','sailboat','hangglider','snowman','skier','snowangel']);
 const actors=e=>e.type==='cyclist'?e.count||1:['couple','picnic'].includes(e.type)?2:1;
 const digest=events=>createHash('sha256').update(JSON.stringify(events.map(e=>[e.id,e.type,actors(e),e.duration,e.activityDuration,e.count??null]))).digest('hex');
 const from=Date.parse('2026-10-20T08:00:00.000Z'),seed='daytime-people-20261024';
 function timeline(baseline,season,altitude,sunAt){
  const context=sceneTimeline(baseline?{'landscape-timeline.js':()=>baselineSource.stdout}:{});
  return context.LandscapeTimeline.create({seed,season,sunAt:sunAt||(()=>({altitude,azimuth:90}))});
 }
 function capture(value,fromMs,durationSeconds){
  const events=new Map();
  for(let seconds=0;seconds<durationSeconds;seconds+=8){
   const at=fromMs+seconds*1000;
   for(const valueEvent of value.at(at).events){
    const start=at-Math.round(valueEvent.age*1000);
    if(start<fromMs||start>=fromMs+durationSeconds*1000)continue;
    const event=JSON.parse(JSON.stringify(valueEvent));delete event.age;
    const prior=events.get(event.id);
    if(prior)assert.deepEqual(event,prior.event,`${event.id} keeps one complete immutable visit recipe`);
    else events.set(event.id,{start,event});
   }
  }
  return [...events.values()].sort((a,b)=>a.event.id.localeCompare(b.event.id));
 }
 function checkPopulation(label,season,altitude,durationSeconds,expected,thin){
  const reference=timeline(true,season,altitude),candidate=timeline(false,season,altitude);
  const baseline=capture(reference,from,durationSeconds),actual=capture(candidate,from,durationSeconds);
  const baselinePeople=baseline.filter(row=>people.has(row.event.type)).map(row=>row.event),actualPeople=actual.filter(row=>people.has(row.event.type)).map(row=>row.event);
  const baselineOthers=baseline.filter(row=>!people.has(row.event.type)).map(row=>row.event),actualOthers=actual.filter(row=>!people.has(row.event.type)).map(row=>row.event);
  const baselineActors=baselinePeople.reduce((n,e)=>n+actors(e),0),actualActors=actualPeople.reduce((n,e)=>n+actors(e),0);
  assert.equal(baseline.length,expected.events,`${label} independently pinned baseline event population`);
  assert.equal(baselinePeople.length,expected.people,`${label} independently pinned baseline human events`);
  assert.equal(baselineActors,expected.actors,`${label} independently pinned baseline visible human count`);
  assert.equal(baselineOthers.length,expected.others,`${label} independently pinned baseline nonhuman population`);
  assert.equal(digest(baselinePeople),expected.peopleDigest,`${label} baseline human IDs and complete recipes stay pinned`);
  assert.equal(digest(baselineOthers),expected.othersDigest,`${label} baseline nonhuman IDs and complete recipes stay pinned`);
  if(thin){
   const baselineById=new Map(baselinePeople.map(e=>[e.id,e]));
   for(const event of actualPeople){
    assert.ok(baselineById.has(event.id),`${label} thins the established admission plan without replacing a person`);
    assert.deepEqual(event,baselineById.get(event.id),`${label} keeps a selected person, whole party, and complete visit unchanged`);
   }
   assert.ok(actualPeople.length<baselinePeople.length,`${label} removes newly admitted people from the shared scene`);
   assert.deepEqual(actualOthers,baselineOthers,`${label} keeps every nonhuman event, identity, and lifetime unchanged`);
   assert.ok(actualActors>=Math.ceil(baselineActors*.45)&&actualActors<=Math.floor(baselineActors*.55),`${label} sampled human spawn rate should be near half when weighted for visible people (${actualActors}/${baselineActors})`);
  }else{
   assert.deepEqual(actual.map(row=>row.event),baseline.map(row=>row.event),`${label} keeps daytime people and all other night events unchanged`);
   assert.equal(actualActors,baselineActors,`${label} keeps night human count unchanged`);
  }
  const probe=from+2*3600_000+1234,expectedScene=JSON.parse(JSON.stringify(candidate.at(probe))),referenceScene=JSON.parse(JSON.stringify(reference.at(probe)));
  assert.deepEqual(expectedScene.woodland,referenceScene.woodland,`${label} preserves the independent woodland schedule`);
  assert.deepEqual(expectedScene.clouds,referenceScene.clouds,`${label} preserves shared nonhuman cloud scenery`);
  assert.deepEqual(expectedScene.clocktower,referenceScene.clocktower,`${label} preserves independent clocktower appearances`);
  assert.deepEqual(expectedScene.party,referenceScene.party,`${label} preserves independent rooftop visits`);
  candidate.at(from+(durationSeconds-8)*1000);candidate.at(from+23*3600_000);candidate.at(from+3600_000);
  assert.deepEqual(JSON.parse(JSON.stringify(candidate.at(probe))),expectedScene,`${label} repeated and reversed seeks preserve the same public scene`);
  const reopened=timeline(false,season,altitude);reopened.at(from+durationSeconds*1000-8);reopened.at(from-8);
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.at(probe))),expectedScene,`${label} reload reconstructs the same people without viewport or animation history`);
  return {baselinePeople,actualPeople,baselineActors,actualActors,baseline};
 }
 const summer=checkPopulation('summer day','summer',30,14400,{
  events:1610,people:699,actors:965,others:911,
  peopleDigest:'a8ba099171055601c7cc675b71365ea3896756de6f3a96509b12e48be1f51ba2',
  othersDigest:'f4be4c85adb9c8bdcb3e7d96525ee2d65f7898b37cea99817a4254aac7d49970'
 },true);
 const twilight=checkPopulation('summer twilight at the inclusive -6 degree boundary','summer',-6,14400,{
  events:1588,people:681,actors:940,others:907,
  peopleDigest:'b07af8751fd1f3c6bdc78c242f945634651f58694d6539668e054b07f2e630d7',
  othersDigest:'d9e0d200b2f4cfd38f18693520420b3e94faf1ae80ce3c335afb45843fa97300'
 },true);
 checkPopulation('winter day','winter',30,14400,{
  events:1725,people:646,actors:646,others:1079,
  peopleDigest:'dc0ebdb3d5de51e31373efc57004c4a0436db30715f49d0535399a3a572778e8',
  othersDigest:'847fe93c334893e9fc875d1bfd5a596d3f7e772f87987b58476722baff3a5111'
 },true);
 const nightStart=Date.parse('2026-10-20T00:00:00.000Z'),nightBase=timeline(true,'summer',-20),nightNow=timeline(false,'summer',-20);
 const nightBaseline=capture(nightBase,nightStart,7200),nightActual=capture(nightNow,nightStart,7200);
 const nightPeople=nightBaseline.filter(row=>people.has(row.event.type)).map(row=>row.event),nightOthers=nightBaseline.filter(row=>!people.has(row.event.type)).map(row=>row.event);
 assert.equal(nightBaseline.length,263);assert.equal(nightPeople.length,44);assert.equal(nightPeople.reduce((n,e)=>n+actors(e),0),49);
 assert.equal(digest(nightPeople),'d0e80624f556b46ec26876b497d39410bacd9492c4153322213aa3c2ba4a9a78');
 assert.equal(digest(nightOthers),'b604064049737919b5504803afc24bc1fd281aa169748c250190b3214fce9ec8');
 assert.deepEqual(nightActual.map(row=>row.event),nightBaseline.map(row=>row.event),'the complete nighttime event schedule remains identical');
 assert.deepEqual(nightBaseline.filter(row=>row.event.type==='festival').map(row=>row.event.id),['festival:29874306'],'the pinned nighttime festival crowd remains present');
 const nightAt=29874316*60_000,nightScene=nightNow.at(nightAt),nightReferenceScene=nightBase.at(nightAt),clocktower=nightScene.clocktower,clocktowerReference=nightReferenceScene.clocktower;
 assert.deepEqual(JSON.parse(JSON.stringify(clocktower)),JSON.parse(JSON.stringify(clocktowerReference)),'the pinned rare nighttime clocktower visit remains identical');
 assert.deepEqual(JSON.parse(JSON.stringify(clocktower)),{age:0,duration:50,seed:0.3774666809476912,direction:1});
 assert.deepEqual(JSON.parse(JSON.stringify(nightScene.party)),JSON.parse(JSON.stringify(nightReferenceScene.party)),'the independent nighttime rooftop visit remains identical');
 const boundary=Date.parse('2026-10-20T12:00:00.000Z'),sunAt=instant=>({altitude:instant<boundary?30:-20,azimuth:90});
 const boundaryBase=timeline(true,'summer',30,sunAt),boundaryCurrent=timeline(false,'summer',30,sunAt),crossingId='arrival:224062192';
 const before=boundaryCurrent.at(boundary-1000).events.find(e=>e.id===crossingId),after=boundaryCurrent.at(boundary+1000).events.find(e=>e.id===crossingId),afterReference=boundaryBase.at(boundary+1000).events.find(e=>e.id===crossingId);
 assert.equal(before?.type,'picnic','the pinned daytime couple visit begins before sunset');
 assert.equal(after?.type,'picnic','an admitted daylight visit remains visible after twilight becomes night');
 const crossingStart=boundary+1000-Math.round(after.age*1000),crossingEnd=crossingStart+after.duration*1000;
 assert.deepEqual(JSON.parse(JSON.stringify(after)),JSON.parse(JSON.stringify(afterReference)),'the cross-boundary whole party keeps its original full visit recipe');
 assert.ok(boundaryCurrent.at(crossingEnd-1000).events.some(e=>e.id===crossingId),'the selected person completes the original lifetime after sunset');
 assert.ok(!boundaryCurrent.at(crossingEnd+1000).events.some(e=>e.id===crossingId),'the person leaves at the original complete-lifetime boundary');
 const faq=html.split('<dt>Why can the scene have fewer visitors?</dt>')[1].split('</dd>')[0];
 assert.match(faq,/daytime and twilight people spawn about half as often/i);assert.match(faq,/already underway finishes its original visit/i);assert.match(faq,/Nighttime visits keep their existing schedule/i);
 assert.match(faq,/shared arrival budget/);assert.match(faq,/walking visits can continue after their arrival slots are freed/);assert.match(faq,/A new visit in this visitor budget must finish before midnight UTC/);assert.match(faq,/Underway visits finish normally/);assert.match(faq,/Trains, metro, and woodland animals keep their existing schedules/);
 assert.doesNotMatch(faq,/crash|repair|fix/i,'scenery guidance makes no crash-cause claim');
 assert.ok(summer.actualActors<summer.baselineActors&&twilight.actualActors<twilight.baselineActors,'both visible daylight and twilight cohorts are reduced');
});

test('RISK daytime spawn birth phase: rejected daylight parties stay absent after sunset',()=>{
 const released=spawnSync('git',['show','3b273718df28919586c2cd84ca835de573631fe3:landscape-timeline.js'],{cwd:__dirname,encoding:'utf8'});assert.equal(released.status,0,released.stderr);
 const boundary=Date.parse('2026-10-20T12:00:00.000Z'),options={seed:'daytime-people-20261024',season:'summer',sunAt:instant=>({altitude:instant<boundary?30:-20,azimuth:90})};
 const reference=sceneTimeline({'landscape-timeline.js':()=>released.stdout}).LandscapeTimeline.create(options),current=sceneTimeline().LandscapeTimeline.create(options);
 const rejectedId='arrival:224061892',rejected=reference.at(boundary+1000).events.find(e=>e.id===rejectedId);
 assert.equal(rejected?.type,'picnic','an independently pinned rejected daylight party spans sunset');assert.equal(rejected.duration,2584.709);
 const end=boundary+1000-Math.round(rejected.age*1000)+rejected.duration*1000;
 for(const at of [boundary-1000,boundary+1000,end-1000]){
  assert.ok(reference.at(at).events.some(e=>e.id===rejectedId),'the unthinned reference visit is still underway at every sampled instant');
  assert.ok(!current.at(at).events.some(e=>e.id===rejectedId),'a rejected daylight party must not appear again after sunset');
 }
});

test('RISK pedestrian cull painted bounds: real companions held props and winter residue clear the frame before local retirement',async()=>{
 const {readMotionBuild,createMotionProbe}=await import('../scripts/motion-review-harness.mjs'),build=readMotionBuild(__dirname,'WORKTREE'),c=sceneTimeline();
 for(const [width,height]of [[390,844],[1440,900],[8192,900]])for(const reverse of [false,true])for(const type of ['walker','dogwalker','reader','couple','picnic','kite','snowman','snowangel','skier']){
  const g=c.LandscapeGeometry.create(width,height),base={type,seed:.4,lane:.5,reverse,duration:c.LandscapeConfig.eventDurations[type]},event={...base,activityDuration:base.duration,duration:c.LandscapeGeometry.create(8192,900).walkingLifetime(base)},end=g.walkingLifetime(event),probe=createMotionProbe(build,{width,height});
  // Existing activity blankets can be laid out before their owners arrive.
  // Skiers retain their existing faded downhill departure; at the cutoff
  // its zero-opacity paint, rather than its interior anchor, establishes safety.
  const ages=type==='skier'?[end]:['walker','dogwalker','reader'].includes(type)?[0,end-.001]:[end-.001];
  for(const age of ages){const xs=paintedMotionWorldXs(probe.sample({actor:type,event:{...event,age},zoom:1}));assert.ok(xs.every(x=>reverse?(age===0?x>width:x<0):(age===0?x<0:x>width)),`${type} ${width} ${reverse} at ${age}: actual painted party touches frame [${Math.min(...xs)},${Math.max(...xs)}]`);}
 }
});

test('RISK pedestrian gait cache bounds: route prefixes and contact windows have aggregate eviction budgets',()=>{
 const source=fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8').replace('return {stillWalkingAge,','return {cacheStats:()=>({routes:humanRouteOrder.size,nodes:humanRouteNodes,windows:humanClearanceOrder.size,actualWindows:[...humanRouteOrder.keys()].reduce((n,r)=>n+r.clearances.size,0),actualNodes:[...humanRouteOrder.keys()].reduce((n,r)=>n+r.nodes.length,0)}),stillWalkingAge,');const c=vm.createContext({});vm.runInContext(source,c);const g=c.LandscapeGeometry.create(8192,900);
 for(let i=0;i<70;i++){const d=8192+i,x=d-32;g.humanWalkPose(x,g.middle(x)+i/10,d,1,g.humanGround('middle',i/10),false,1,{kind:'constant',speed:3.5,startDistance:0});const stats=g.cacheStats();assert.ok(stats.routes<=64);assert.ok(stats.nodes<=524288);assert.equal(stats.nodes,stats.actualNodes,'node accounting includes eviction and contact extension');assert.ok(stats.windows<=1380);assert.equal(stats.windows,stats.actualWindows,'window ownership matches the aggregate eviction index');}
 const tiny=vm.createContext({});vm.runInContext(source.replace('MAX_HUMAN_CLEARANCES=345*2*2','MAX_HUMAN_CLEARANCES=8'),tiny);const small=tiny.LandscapeGeometry.create(8192,900);for(let i=0;i<12;i++){const x=100+i*20;small.humanWalkPose(x,small.trail(x)+5,x+32,1,small.humanGround('trail',5),false,1,{kind:'constant',speed:3.5,startDistance:0});const stats=small.cacheStats();assert.ok(stats.windows<=8);assert.equal(stats.windows,stats.actualWindows);}assert.equal(small.cacheStats().windows,8,'fixture actually reaches window eviction');
 const event={type:'walker',seed:.3,lane:.5,duration:2400,activityDuration:60,age:100},p=g.groundPose('walker',event),walk=geo=>geo.humanWalkPose(p.x,p.y,p.distance,1,geo.humanGround('trail',5),false,1,p.travel),cold=walk(c.LandscapeGeometry.create(8192,900));assert.deepEqual(walk(g),cold,'an evicted route reconstructs the exact cold pose');assert.deepEqual(JSON.parse(JSON.stringify(walk(small))),JSON.parse(JSON.stringify(cold)),'window eviction reconstructs the exact cold pose across isolated realms');
});
