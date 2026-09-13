/* Every passenger and prop uses the same ground as the painted paths. */
(function(root){
  'use strict';
  function create(W,H){
    const horizon=Math.min(H*(W<600?.37:.47),W<600?310:480);
    const far=x=>horizon+H*.12+Math.sin(x/W*7+.8)*H*.025;
    const middle=x=>horizon+H*.25+Math.sin(x/W*6.5-1)*H*.065;
    const near=x=>horizon+H*.46+Math.sin(x/W*6+1)*H*.10;
    const rail=x=>horizon+H*.145+Math.sin(x/W*3)*H*.01;
    const trail=x=>middle(x)+H*.042;
    const lowerRail=x=>near(x)+H*.07;
    const tangent=(fn,x)=>Math.atan((fn(x+.5)-fn(x-.5)));
    const rider=(x,scale=1,reverse=false)=>({x,y:trail(x)-3.6*scale,angle:tangent(trail,x),direction:reverse?-1:1});
    const skater=(x,reverse=false)=>({x,y:trail(x),angle:tangent(trail,x),direction:reverse?-1:1});
    const pack=(x,count,reverse=false)=>Array.from({length:count},(_,i)=>rider(x-i*21*(reverse?-1:1),1,reverse));
    const waterTop=horizon+15,shore=horizon+H*.095;
    function vessel(kind,lane,x,t=0,reverse=false){
      const depth=Math.max(1,shore-waterTop),direction=reverse?-1:1;
      // Hull sizes are intentionally compressed, but a person and board must
      // remain much smaller than a ship even across opposite depth lanes.
      const base={windsurfer:.4,jetski:.55,sailboat:.8,yacht:.95,cruise:1,duck:.8}[kind]||1;
      const scale=Math.min(1,W/600,depth/38)*base*(.65+.35*Math.max(0,Math.min(1,lane)));
      const course=kind==='windsurfer'?Math.sin(t*(.10+lane*.04)+lane*6)*depth*.12:0;
      const y=waterTop+depth*(.38+Math.max(0,Math.min(1,lane))*.30)+course+Math.sin(t*.8+lane*6)*scale*.5;
      return {x,y,scale,direction,visible:depth>10};
    }
    function duckPose(e,t,index=0){
      const direction=e.reverse?-1:1,progress=e.age/e.duration;
      const x=-160+(e.reverse?1-progress:progress)*(W+320)-index*8*direction;
      const takeoff=e.duration*(.35+e.seed*.15)+index*.35;
      // A visit's random seed chooses whether and when to depart. No frame-time
      // randomness means pausing or redrawing cannot reroll or teleport a duck.
      const flight=e.seed>.65?Math.max(0,e.age-takeoff):0;
      const water=vessel('duck',e.lane,x,t-flight,e.reverse);
      const lift=7*flight*(1-Math.exp(-flight));
      return {x:x+direction*1.5*flight*flight,y:water.y+Math.sin(t-flight+index)*.3-lift,
        scale:Math.min(.5,water.scale*.65),direction,flying:flight>0,wing:Math.sin(flight*13+index)*5};
    }
    function waterDepth(e,t){
      // Sort at the waterline, not at a mast top or an animal's airborne height.
      if(e.type==='fish')return waterTop+H*.035;
      if(e.type==='dolphin')return dolphin(e.age/e.duration,e.lane,e.reverse).waterY;
      const progress=e.reverse?1-e.age/e.duration:e.age/e.duration;
      return vessel(e.type,e.lane,-160+progress*(W+320),t,e.reverse).y;
    }
    const foregroundTree=(x,y)=>Math.abs(y-lowerRail(x))<22?lowerRail(x)+23:Math.max(near(x)+2,y);
    const nest=()=>{const treeX=W*.9,ground=middle(treeX)+3,x=treeX-13,y=ground-21;return {treeX,ground,x,y,perches:[{x:x-2,y:y-1.5},{x:x+2,y:y-1.5}]};};
    const depthBand=(x,y)=>y>lowerRail(x)?'front':'back';
    const groundAnchor=(kind,x)=>trail(x)+(kind==='walker'?5:15);
    // Local meadow journeys keep speed independent of viewport width.
    const groundTravelX=(age,reverse=false,lane=.5,duration=22,speed=6)=>W*(.18+lane*.64)+(reverse?-1:1)*(age-duration/2)*speed;
    function groundPose(kind,e){
      const direction=e.reverse?-1:1,speed=kind==='walker'?7:6;
      let x=groundTravelX(e.age,e.reverse,e.lane,e.duration,speed),hop=0;
      if(kind==='rabbit'){
        const cycle=e.age/1.2,phase=cycle%1,flight=Math.max(0,(phase-.3)/.7),travel=Math.floor(cycle)*10+flight*10;
        x=W*(.18+e.lane*.64)+direction*(travel-e.duration/1.2*5);
        hop=Math.sin(flight*Math.PI)*5;
      }
      return {x,y:groundAnchor(kind,x),direction,hop,distance:e.age*speed};
    }
    function eventDepth(e){
      if(['walker','dogwalker','rabbit','deer'].includes(e.type))return groundPose(e.type==='dogwalker'?'walker':e.type,e).y;
      if(['reader','picnic','couple','kite'].includes(e.type))return visitPose(e,e.age/e.duration).y;
      const progress=e.reverse?1-e.age/e.duration:e.age/e.duration;
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
      const departure=smooth(.82,1,f),arrival=smooth(0,.12,f);
      const x=anchor-direction*40*(1-arrival)+((e.reverse?-80:W+80)-anchor)*departure;
      return {x,y:trail(x)+19,anchor,direction,pack:smooth(.72,.82,f),stand:Math.max(1-arrival,smooth(.76,.82,f)),walkAmount:Math.max(1-smooth(.08,.12,f),smooth(.82,.85,f)),walking:f<.12||f>.82};
    }
    function woodlandPose(e){
      // Pick a clearing with room for a short stroll on the darkest near hill.
      // The clearings depend on terrain rather than a viewport-specific y value.
      const clearings=Array.from({length:12},(_,i)=>W*(.15+i*.7/11)).filter(x=>Math.max(near(x-24),near(x),near(x+24))<H-65);
      const anchor=clearings[Math.min(clearings.length-1,Math.floor(e.lane*clearings.length))]||W*.7;
      const direction=e.reverse?-1:1,distance=e.age*.22;
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
    function nestVisit(f,lane,reverse,perch,index=0){
      const ease=value=>{const v=Math.max(0,Math.min(1,value));return v*v*(3-2*v);};
      const arrival=ease(f/.55),departure=ease((f-.72)/.28);
      const startX=(reverse?W+30:-30)+(reverse?1:-1)*index*16;
      const endX=(reverse?-30:W+30)+(reverse?-1:1)*index*16;
      const flightY=horizon*.42+lane*30+index*7;
      const x=f<.55?startX+(perch.x-startX)*arrival:perch.x+(endX-perch.x)*departure;
      const y=f<.55?flightY+(perch.y-flightY)*arrival-Math.sin(arrival*Math.PI)*35
        :perch.y+(flightY-perch.y)*departure-Math.sin(departure*Math.PI)*35;
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
    const balloonDrift=(seed,t,wind=1)=>({
      x:Math.sin(t*wind*(.08+seed*.025)+seed*17)*8+Math.sin(t*.17+seed*31)*3,
      y:Math.sin(t*wind*(.10+seed*.04)+seed*23)*17+Math.sin(t*.23+seed*11)*8
    });
    function starReflection(star,t,wind){
      if(star.altitude<=0||star.magnitude>2.5)return null;
      const depth=Math.min(H*.09,95),y=waterTop+5+star.altitude/90*depth;
      return {x:star.azimuth/360*W+Math.sin(y*.19-t*wind)*1.8,y};
    }
    function dolphin(progress,lane,reverse=false){
      const direction=reverse?-1:1,depth=Math.max(1,shore-waterTop),scale=Math.min(.9,W/600,depth/30);
      const x=W*(.2+.6*lane)+direction*(progress-.5)*45,waterY=waterTop+depth*.6;
      return {x,y:waterY-Math.sin(progress*Math.PI)*Math.min(9,depth*.22),waterY,scale,direction};
    }
    const flock=(x,y,reverse=false)=>Array.from({length:7},(_,i)=>{
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
    function cityReflection(t,wind,night){
      if(night<=0)return [];
      const depth=Math.min(H*.12,140),rows=[];
      for(let d=0;d<depth;d+=2){
        const fraction=d/depth;
        rows.push({sourceY:Math.max(0,waterTop-(d+2)/1.35),y:waterTop+d,
          dx:(Math.sin(d*.23-t*wind*.8)*1.8+Math.sin(d*.09+t*wind*.35))*(.25+.75*fraction),
          alpha:Math.min(.3,night*.28)*(1-fraction)**1.5*(.65+.35*Math.sin(d*.7-t*wind)**2)});
      }
      return rows;
    }
    const ripple=(i,t,wind=1)=>({alpha:.15+.75*(.5+.5*Math.sin(t*wind*1.3+i*1.71))**2,drift:Math.sin(t*wind*.5+i)*9,width:.65+.35*Math.sin(t*.9+i)**2});
    return {visitPose,woodlandPose,duckPose,waterDepth,cycleLeg,deerLeg,nestVisit,eventDepth,dogPose,skater,fireworks,flock,dolphin,starReflection,cityReflection,sunReflection,depthBand,groundAnchor,groundTravelX,groundPose,strideArm,strideFoot,wingFold,balloonDrift,vessel,foregroundTree,nest,ripple,horizon,waterTop,far,middle,near,rail,trail,lowerRail,tangent,rider,pack};
  }
  root.LandscapeGeometry={create};
})(globalThis);
