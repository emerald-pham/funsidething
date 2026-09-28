/* Every passenger and prop uses the same ground as the painted paths. */
(function(root){
  'use strict';
  function create(W,H){
    const FIXED_X_TYPES=new Set(['cyclist','train','metro','plane','balloon','airshow','banner','hangglider','jetski','sailboat','cruise','yacht','skateboarder','rollerskater','hoverboard','scooter','windsurfer']);
    const clamp=value=>Math.max(0,Math.min(1,Number.isFinite(Number(value))?Number(value):0));
    const unit=value=>((value%1)+1)%1;
    const rawProgress=event=>{
      const duration=Math.max(.001,Number(event?.duration)||1);
      return clamp((Number(event?.age)||0)/duration);
    };
    // Each visit keeps its exact entrance, exit and lifetime, but eases through
    // two or three gentle seeded pace changes. Independent axis phases stop
    // airborne and breaching visitors from tracing one mechanical diagonal.
    function motionProgress(event,axis='x',offset=0){
      const raw=rawProgress(event);
      if(raw===0||raw===1)return raw;
      const seed=clamp(event?.seed??.5),salt=axis==='y'?.417:.071;
      const character=unit(seed+Number(offset||0)*.61803398875+salt);
      const strength=.16+.06*unit(character*7.13+.29),cycles=2+(unit(character*5.37+.11)>.5?1:0);
      const phase=Math.PI*2*unit(character*11.71+.23),angle=Math.PI*2*cycles*raw;
      return clamp(raw+strength/(Math.PI*2*cycles)*(Math.sin(angle+phase)-Math.sin(phase)));
    }
    const motionAge=(event,axis='x',offset=0)=>motionProgress(event,axis,offset)*Math.max(.001,Number(event?.duration)||1);
    // Vehicle silhouettes cross at a constant horizontal rate. Their bodies,
    // wheels, water courses and flight altitude still use the varied clocks.
    const routeProgress=(event,axis='x',offset=0)=>axis==='x'&&FIXED_X_TYPES.has(event?.type)?rawProgress(event):motionProgress(event,axis,offset);
    // A separate seeded vertical wave makes flight and water motion perceptible
    // without changing the constant crossing speed of vehicles.
    const verticalOffset=(event,amplitude=20)=>{
      const progress=motionProgress(event,'y'),seed=clamp(event?.seed??.5);
      return Math.sin(Math.PI*progress)*Math.sin(Math.PI*2*(1.7*progress+seed))*amplitude;
    };
    const horizon=Math.min(H*(W<600?.37:.47),W<600?310:480);
    // The light origin must be exactly the point used to paint its sky disc.
    const skyPoint=(azimuth,altitude)=>({x:azimuth/360*W,
      y:horizon-(Math.max(altitude,-2)/90)*(horizon-22)});
    const far=x=>horizon+H*.12+Math.sin(x/W*7+.8)*H*.025;
    const middle=x=>horizon+H*.25+Math.sin(x/W*6.5-1)*H*.065;
    const near=x=>horizon+H*.46+Math.sin(x/W*6+1)*H*.10;
    const rail=x=>horizon+H*.145+Math.sin(x/W*3)*H*.01;
    const trail=x=>middle(x)+H*.042;
    const lowerRail=x=>near(x)+H*.07;
    function railCars(x,count,spacing=26,reverse=false){
      const cars=[{x,y:lowerRail(x),angle:tangent(lowerRail,x)}],direction=reverse?1:-1;
      for(let i=1;i<count;i++){
        const previous=cars[i-1];let low=0,high=spacing*2;
        // Solve for the projected center distance on the curved lower track.
        // A fixed x step made cars visibly bunch on steep phone hills.
        for(let step=0;step<20;step++){
          const mid=(low+high)/2,nextX=previous.x+direction*mid;
          if(Math.hypot(mid,lowerRail(nextX)-previous.y)<spacing)low=mid;else high=mid;
        }
        const nextX=previous.x+direction*(low+high)/2;
        cars.push({x:nextX,y:lowerRail(nextX),angle:tangent(lowerRail,nextX)});
      }
      return cars;
    }
    const tangent=(fn,x)=>Math.atan((fn(x+.5)-fn(x-.5)));
    const rider=(x,scale=1,reverse=false)=>({x,y:trail(x)-3.6*scale,angle:tangent(trail,x),direction:reverse?-1:1});
    const skater=(x,reverse=false)=>({x,y:trail(x),angle:tangent(trail,x),direction:reverse?-1:1});
    const pack=(x,count,reverse=false)=>Array.from({length:count},(_,i)=>rider(x-i*21*(reverse?-1:1),1,reverse));
    const waterTop=horizon+15,shore=horizon+H*.095;
    function vessel(kind,lane,x,t=0,reverse=false){
      const depth=Math.max(1,shore-waterTop),direction=reverse?-1:1;
      // Hull sizes are intentionally compressed, but a person and board must
      // remain much smaller than a ship even across opposite depth lanes.
      const base={windsurfer:.4,jetski:.95,sailboat:.8,yacht:.95,cruise:1,duck:1.05}[kind]||1;
      const scale=Math.min(1,W/600,depth/38)*base*(.65+.35*Math.max(0,Math.min(1,lane)));
      const course=kind==='windsurfer'?Math.sin(t*(.10+lane*.04)+lane*6)*depth*.12:0;
      const y=waterTop+depth*(.38+Math.max(0,Math.min(1,lane))*.30)+course+Math.sin(t*.8+lane*6)*scale*.5;
      return {x,y,scale,direction,visible:depth>10};
    }
    function duckPose(e,t,index=0){
      const direction=e.reverse?-1:1,progress=motionProgress(e,'x',index),ageY=motionAge(e,'y',index);
      const x=-160+(e.reverse?1-progress:progress)*(W+320)-index*8*direction;
      const takeoff=e.duration*(.35+e.seed*.15)+index*.35;
      // A visit's random seed chooses whether and when to depart. No frame-time
      // randomness means pausing or redrawing cannot reroll or teleport a duck.
      const rawAge=Number(e.age)||0,flying=e.seed>.65&&rawAge>takeoff;
      const takeoffEvent={...e,age:takeoff};
      const flightX=flying?Math.max(0,motionAge(e,'x',index)-motionAge(takeoffEvent,'x',index)):0;
      const flightY=flying?Math.max(0,ageY-motionAge(takeoffEvent,'y',index)):0;
      const water=vessel('duck',e.lane,x,ageY-flightY,e.reverse);
      const lift=7*flightY*(1-Math.exp(-flightY));
      return {x:x+direction*1.5*flightX*flightX,y:water.y+Math.sin(ageY-flightY+index)*.3-lift,waterY:water.y,
        scale:Math.min(.75,water.scale*.82),direction,flying,wing:Math.sin(flightY*13+index)*5};
    }
    function waterDepth(e,t){
      // Sort at the waterline, not at a mast top or an animal's airborne height.
      if(e.type==='fish')return waterTop+H*.035;
      if(e.type==='dolphin')return dolphin(motionProgress(e,'x'),e.lane,e.reverse,motionProgress(e,'y')).waterY;
      const progress=e.reverse?1-routeProgress(e,'x'):routeProgress(e,'x');
      return vessel(e.type,e.lane,-160+progress*(W+320),motionAge(e,'y'),e.reverse).y;
    }
    const foregroundTree=(x,y)=>Math.abs(y-lowerRail(x))<22?lowerRail(x)+23:Math.max(near(x)+2,y);
    const nest=()=>{const treeX=W*.9,ground=middle(treeX)+3,x=treeX-13,y=ground-21;return {treeX,ground,x,y,perches:[{x:x-2,y:y-1.5},{x:x+2,y:y-1.5}]};};
    const depthBand=(x,y)=>y>lowerRail(x)?'front':'back';
    const groundAnchor=(kind,x)=>trail(x)+(kind==='walker'?5:15);
    // Local meadow journeys keep speed independent of viewport width.
    const groundTravelX=(age,reverse=false,lane=.5,duration=22,speed=6)=>W*(.18+lane*.64)+(reverse?-1:1)*(age-duration/2)*speed;
    function groundPose(kind,e){
      const direction=e.reverse?-1:1,speed=kind==='walker'?7:6,age=motionAge(e,'x');
      let x=groundTravelX(age,e.reverse,e.lane,e.duration,speed),hop=0;
      if(kind==='rabbit'){
        const cycle=age/1.2,phase=cycle%1,flight=Math.max(0,(phase-.3)/.7),travel=Math.floor(cycle)*10+flight*10;
        x=W*(.18+e.lane*.64)+direction*(travel-e.duration/1.2*5);
        hop=Math.sin(flight*Math.PI)*5;
      }
      return {x,y:groundAnchor(kind,x),direction,hop,distance:age*speed};
    }
    function eventDepth(e){
      if(['walker','dogwalker','rabbit','deer'].includes(e.type))return groundPose(e.type==='dogwalker'?'walker':e.type,e).y;
      if(['reader','picnic','couple','kite'].includes(e.type))return visitPose(e,motionProgress(e,'x')).y;
      const progress=e.reverse?1-routeProgress(e,'x'):routeProgress(e,'x');
      return trail(-160+progress*(W+320));
    }
    function dogPose(ownerX,distance,direction){
      const x=ownerX+direction*(16+Math.sin(distance*.15)*4);
      // Include the dog's small lead changes in its traveled distance so paws
      // stay planted during stance rather than sliding behind a faster leg cycle.
      return {x,y:groundAnchor('walker',x),direction,distance:distance+Math.sin(distance*.15)*4};
    }
    function visitPose(e,f){
      const smooth=(a,b,v)=>{const q=Math.max(0,Math.min(1,(v-a)/(b-a)));return q*q*(3-2*q);};
      const direction=e.reverse?-1:1,anchor=W*(.1+e.lane*.8);
      // Seeded visitors no longer all stand at the same fraction of their
      // visit. A high seed buys a longer settled stay, while seedless geometry
      // callers retain the original .82 boundary used by older contracts.
      const seeded=Number.isFinite(e.seed),seed=seeded?Math.max(0,Math.min(.999999,e.seed)):.5;
      const departureStart=seeded?.82+seed*.12:.82,packStart=departureStart-.1,standStart=departureStart-.06;
      const departure=smooth(departureStart,1,f),arrival=smooth(0,.12,f);
      const x=anchor-direction*40*(1-arrival)+((e.reverse?-80:W+80)-anchor)*departure;
      return {x,y:trail(x)+19,anchor,direction,pack:smooth(packStart,departureStart,f),stand:Math.max(1-arrival,smooth(standStart,departureStart,f)),walkAmount:Math.max(1-smooth(.08,.12,f),smooth(departureStart,departureStart+.03,f)),walking:f<.12||f>departureStart};
    }
    function woodlandPose(e){
      // Pick a clearing with room for a short stroll on the darkest near hill.
      // The clearings depend on terrain rather than a viewport-specific y value.
      const clearings=Array.from({length:12},(_,i)=>W*(.15+i*.7/11)).filter(x=>Math.max(near(x-24),near(x),near(x+24))<H-65);
      const anchor=clearings[Math.min(clearings.length-1,Math.floor(e.lane*clearings.length))]||W*.7;
      const direction=e.reverse?-1:1,distance=motionAge(e,'x')*.22;
      const x=anchor+direction*(distance-19.8),y=Math.max(near(x)+18,H-28-e.seed*25);
      return {x,y,direction,distance,scale:W<600?1.25:1.6};
    }
    function cycleLeg(t,offset=0){
      const phase=t*6+offset*Math.PI*2,footX=2+Math.cos(phase)*1.7,footY=Math.sin(phase)*1.7;
      // Two equal-length segments connect the seated hip to the moving pedal.
      const hipX=-1,hipY=-6,dx=footX-hipX,dy=footY-hipY,d=Math.hypot(dx,dy),bend=Math.sqrt(Math.max(0,4.5**2-d*d/4));
      // Keep the forward knee solution throughout the stroke; the seated hip
      // must match the torso, and neither limb may stretch to reach a pedal.
      return {hipX,hipY,kneeX:hipX+dx/2+dy/d*bend,kneeY:hipY+dy/2-dx/d*bend,footX,footY};
    }
    function deerLeg(pose,hip,offset){
      const angle=tangent(trail,pose.x),foot=strideFoot(pose.distance,12,offset);
      const footX=pose.x+pose.direction*(hip+foot.x);
      // The torso is rotated with the slope; its leg roots must use that same
      // transform while hooves remain planted on the actual ground curve.
      return {hipX:pose.x+Math.cos(angle)*pose.direction*hip+Math.sin(angle)*8,
        hipY:pose.y+Math.sin(angle)*pose.direction*hip-Math.cos(angle)*8,
        footX,footY:groundAnchor('deer',footX)-foot.lift};
    }
    function nestVisit(f,lane,reverse,perch,index=0,vertical=f){
      const ease=value=>{const v=Math.max(0,Math.min(1,value));return v*v*(3-2*v);};
      const arrival=ease(f/.55),departure=ease((f-.72)/.28);
      const startX=(reverse?W+30:-30)+(reverse?1:-1)*index*16;
      const endX=(reverse?-30:W+30)+(reverse?-1:1)*index*16;
      const flightY=horizon*.42+lane*30+index*7;
      const x=f<.55?startX+(perch.x-startX)*arrival:perch.x+(endX-perch.x)*departure;
      const verticalArrival=ease(vertical/.55),verticalDeparture=ease((vertical-.72)/.28);
      const y=f<.55?flightY+(perch.y-flightY)*verticalArrival-Math.sin(verticalArrival*Math.PI)*35
        :perch.y+(flightY-perch.y)*verticalDeparture-Math.sin(verticalDeparture*Math.PI)*35;
      return {x,y,perched:f>=.55&&f<=.72,twig:f<.55};
    }
    function strideArm(distance,stride,offset=0){
      const x=-3*Math.cos((distance/stride+offset)*Math.PI*2);
      return {x,y:Math.sqrt(25-x*x)};
    }
    function strideFoot(distance,stride,offset=0){
      const phase=((distance/stride+offset)%1+1)%1;
      if(phase<.6)return {x:(.3-phase)*stride,lift:0};
      const swing=(phase-.6)/.4;
      return {x:(-.3+.6*swing)*stride,lift:Math.sin(swing*Math.PI)*2};
    }
    const wingFold=(t,seed)=>{const right=.12+.88*Math.abs(Math.sin(t*7+seed*12));return {left:-right,right};};
    const balloonDrift=(seed,t,wind=1,verticalTime=t)=>({
      x:Math.sin(t*wind*(.08+seed*.025)+seed*17)*8+Math.sin(t*.17+seed*31)*3,
      y:Math.sin(verticalTime*wind*(.10+seed*.04)+seed*23)*17+Math.sin(verticalTime*.23+seed*11)*8
    });
    function starReflection(star,t,wind){
      if(star.altitude<=0||star.magnitude>2.5)return null;
      const depth=Math.min(H*.09,95),y=waterTop+5+star.altitude/90*depth;
      return {x:star.azimuth/360*W+Math.sin(y*.19-t*wind)*1.8,y};
    }
    function reflectionSurface(night){
      // One waterline preserves each object's height and unbroken edge. The
      // shore clips high reflections; softness grows only within the lake.
      const softDepth=Math.max(30,H*.12),softMax=.36,contactDepth=3,alpha=.47+night*.09;
      return {axisY:waterTop,alpha,softDepth,softMax,contactDepth,
        mirrorY:y=>2*waterTop-y,
        softness:depth=>Math.min(softMax,Math.max(0,depth)/softDepth*softMax),
        contactAlpha:depth=>alpha+(1-alpha)*Math.max(0,1-Math.max(0,depth)/contactDepth)};
    }
    function castShadow(sky,height,width,x=W/2,y=H*.75){
      const sun=sky?.sun||{},moon=sky?.moon||{},illumination=clamp(sky?.illumination);
      // Direct light comes from a body above the horizon. Sunlight always
      // dominates moonlight when both are up; stars have no single ray.
      const sunStrength=sun.altitude>0? .1+.08*Math.sin(Math.min(90,sun.altitude)*Math.PI/180):0;
      const moonStrength=moon.altitude>0&&illumination>.08?
        (.035+.075*illumination)*Math.sin(Math.min(90,moon.altitude)*Math.PI/180)**.5:0;
      const source=sunStrength>0?'sun':moonStrength>.014?'moon':'stars';
      const body=source==='sun'?sun:moon;
      const altitude=source==='stars'?90:Math.max(3,Number(body.altitude)||0);
      const length=source==='stars'?0:Math.min(Math.max(3,height),
        Math.max(3,height)*.75/Math.tan(altitude*Math.PI/180));
      const origin=source==='stars'?null:skyPoint(Number(body.azimuth)||0,Number(body.altitude)||0);
      // Use the body actually painted on this screen, including at its edges.
      // A wrapped sky copy would reverse a tree's shadow toward the visible Moon.
      const awayX=origin?x-origin.x:0;
      const awayY=origin?Math.max(1,y-origin.y):0,distance=Math.hypot(awayX,awayY)||1;
      const dx=length*awayX/distance,dy=length*awayY/distance;
      return {source,origin,dx,dy,rx:Math.max(1,width*.42+length*.48),ry:Math.max(.7,width*.16+length*.07),
        alpha:source==='sun'?sunStrength:source==='moon'?moonStrength:.012};
    }
    function grassBand(kind){
      const bounds=kind==='far'?x=>[far(x)+3,rail(x)-4]:kind==='middle'?x=>[middle(x)+3,near(x)-12]:x=>[near(x)+30,H-3];
      const depth=Array.from({length:9},(_,i)=>{const [top,bottom]=bounds(W*i/8);return Math.max(0,bottom-top);})
        .reduce((sum,value)=>sum+value,0)/9;
      const density=.0033*(kind==='near'?1:.72),count=Math.max(1,Math.round(W*depth*density));
      const scale=Math.max(.65,Math.min(1.25,H/844));
      const height=(kind==='far'?1.4:kind==='middle'?2.8:5)*scale;
      const salt=kind==='far'?3100:kind==='middle'?4100:5100;
      const random=n=>unit(Math.sin(n*127.1+311.7)*43758.5453);
      const blades=[];
      // The railway sometimes meets the far hill. Retry those hidden samples
      // so the remaining visible strip does not lose grass density.
      for(let i=0;blades.length<count&&i<count*12;i++){
        const x=random(i+salt)*W,[top,bottom]=bounds(x);
        if(bottom<=top)continue;
        blades.push({x,y:top+random(i+salt+671)*Math.max(0,bottom-top),height:height*(.65+random(i+salt+1073)*.7),seed:random(i+salt+1973)});
      }
      return blades;
    }
    function dolphin(progress,lane,reverse=false,verticalProgress=progress){
      const direction=reverse?-1:1,depth=Math.max(1,shore-waterTop),scale=Math.min(1.2,W/560,depth/20);
      const x=W*(.2+.6*lane)+direction*(progress-.5)*45,waterY=waterTop+depth*.6;
      return {x,y:waterY-Math.sin(verticalProgress*Math.PI)*Math.min(9,depth*.22),waterY,scale,direction};
    }
    const flock=(x,y,reverse=false,count=7)=>Array.from({length:Math.max(1,Math.min(11,Math.floor(count)||7))},(_,i)=>{
      const rank=Math.ceil(i/2);return {x:x-rank*15*(reverse?-1:1),y:y+(i%2?1:-1)*rank*7};
    });
    function fireworks(age,seed){
      const dots=[];
      for(let burst=0;burst<3;burst++){
        const time=age-1-burst*2.1;if(time<=0||time>=2.7)continue;
        const cx=W*(.25+seed*.3+burst*.13),cy=horizon*(.28+(burst%2)*.12);
        const radius=Math.min(35,horizon*.18)*(1-Math.exp(-time*1.6)),alpha=Math.min(1,time/.12)*(1-time/2.7)**1.5;
        for(let i=0;i<16;i++){
          const angle=i*Math.PI/8+seed*6,dx=Math.cos(angle)*radius,dy=Math.sin(angle)*radius,fall=time*time*1.5;
          dots.push({x:cx+dx,y:cy+dy+fall,tailX:cx+dx*.78,tailY:cy+dy*.78+fall,alpha,burst});
        }
      }
      return dots;
    }
    const sunReflection=sun=>sun.visible&&sun.altitude>0;
    const ripple=(i,t,wind=1)=>({alpha:.15+.75*(.5+.5*Math.sin(t*wind*1.3+i*1.71))**2,drift:Math.sin(t*wind*.5+i)*9,width:.65+.35*Math.sin(t*.9+i)**2});
    // One affine sway keeps every reflected pixel moving together. Its zero at
    // the waterline preserves the clean horizon join and natural object height.
    const reflectionMotion=(t,wind=1,frozen=false)=>({
      shear:frozen?0:Math.sin(t*Math.max(.35,Number(wind)||1)*.82)*Math.min(.022,5/Math.max(1,waterTop))
    });
    return {routeProgress,motionProgress,motionAge,verticalOffset,visitPose,woodlandPose,duckPose,waterDepth,cycleLeg,deerLeg,nestVisit,eventDepth,dogPose,skater,fireworks,flock,dolphin,starReflection,reflectionSurface,reflectionMotion,castShadow,grassBand,sunReflection,depthBand,groundAnchor,groundTravelX,groundPose,strideArm,strideFoot,wingFold,balloonDrift,vessel,foregroundTree,nest,ripple,skyPoint,horizon,waterTop,far,middle,near,rail,trail,lowerRail,railCars,tangent,rider,pack};
  }
  root.LandscapeGeometry={create};
})(globalThis);
