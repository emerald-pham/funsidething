/* Every passenger and prop uses the same ground as the painted paths. */
(function(root){
  'use strict';
  function create(W,H){
    const FIXED_X_TYPES=new Set(['festival','cyclist','train','metro','plane','balloon','airshow','banner','hangglider','jetski','sailboat','cruise','yacht','skateboarder','rollerskater','hoverboard','scooter','windsurfer']);
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
    function cityscape(random=()=>.5){
      const groundY=horizon+12,count=Math.ceil(W/15);
      const towers=Array.from({length:count},(_,index)=>{
        const x=index*W/count,cluster=.4+.6*Math.pow(Math.sin(x/W*Math.PI*3+.5),2);
        const height=(18+random(index+14)*65)*cluster*(W<600?.8:1),width=7+random(index+91)*18;
        return {index,x,y:groundY-height,width,height,bw:width,bh:height,hasLightningRod:random(index+33)>.68};
      });
      const tallest=Math.max(...towers.map(tower=>tower.height));
      const partyPalettes=[['#ff65aa','#5de0eb','#ffd16b'],['#bd8bff','#65e5a8','#ff9b69'],['#59c7ff','#ff78d1','#f4d76c']];
      const partyRoofs=towers.filter(tower=>tower.height>=(W<600?14:22)&&tower.height<tallest*.78&&!tower.hasLightningRod)
        .map(tower=>({...tower,partyPhase:random(tower.index+1411)*Math.PI*2,partyColors:partyPalettes[Math.floor(random(tower.index+1531)*partyPalettes.length)]}));
      const eligible=partyRoofs.filter(tower=>random(tower.index+702)>.55);
      const gardens=[],patios=[];
      for(const tower of eligible){
        const details={...tower,lights:1+Math.floor(random(tower.index+951)*2)};
        if(random(tower.index+1307)>.5)patios.push(details);
        else gardens.push(details);
      }
      return {groundY,towers,gardens,patios,partyRoofs};
    }
    function clocktowerRoof(){
      const x=W*.71,baseY=horizon-76;
      return {left:{x:x-11,y:baseY},apex:{x,y:horizon-91},right:{x:x+11,y:baseY}};
    }
    const clocktowerVisitSchedule=Object.freeze({interval:60,chance:.02,duration:50});
    function createClocktowerVisitScheduler(random=Math.random){
      return {random,elapsed:0,untilOpportunity:clocktowerVisitSchedule.interval,active:null};
    }
    function advanceClocktowerVisit(state,dt,night=false,rate=root.LandscapeConfig?.spawnRate('clocktower-visit')??1){
      if(!state)return null;
      // Dawn and a disabled rate cancel immediately, including a static repaint.
      if(!night||!(rate>0)){state.active=null;state.untilOpportunity=clocktowerVisitSchedule.interval;return null;}
      if(!Number.isFinite(dt)||dt<=0)return state.active;
      state.elapsed+=dt;
      if(state.active){
        state.active.age+=dt;
        if(state.active.age>=state.active.duration){state.active=null;state.untilOpportunity=clocktowerVisitSchedule.interval;}
        return state.active;
      }
      state.untilOpportunity-=dt;
      if(state.untilOpportunity>0)return null;
      state.untilOpportunity=clocktowerVisitSchedule.interval; // One roll, never a missed-frame backlog.
      if(state.random()>=Math.min(1,clocktowerVisitSchedule.chance*rate))return null;
      const seed=clamp(state.random());
      state.active={age:0,duration:clocktowerVisitSchedule.duration,seed,direction:seed<.5?1:-1};
      return state.active;
    }
    function clocktowerVisitPoses(event,reduced=false){
      const roof=clocktowerRoof(),age=Math.max(0,Number(event?.age)||0),duration=Number(event?.duration)||50;
      const direction=event?.direction===-1?-1:1,seed=clamp(event?.seed??.5);
      const ease=value=>{const t=clamp(value);return t*t*(3-2*t);};
      const roofY=x=>roof.left.y-(1-Math.abs(x-roof.apex.x)/11)*15;
      const curve=(a,b,c,d,t)=>({x:(1-t)**3*a.x+3*(1-t)**2*t*b.x+3*(1-t)*t*t*c.x+t**3*d.x,
        y:(1-t)**3*a.y+3*(1-t)**2*t*b.y+3*(1-t)*t*t*c.y+t**3*d.y});
      return ['peter','wendy','john','michael'].map((character,index)=>{
        const offset=[-3,3,-8,8][index],target={x:roof.apex.x+offset,y:roofY(roof.apex.x+offset)};
        const delay=[0,.9,1.9,3][index],landing=delay+12+index*.6,takeoff=29+[0,1.2,2.6,4][index],exit=takeoff+12+index*.4;
        const entry={x:direction===1?-40:W+40,y:Math.max(24,roof.apex.y-Math.min(46,H*.12))-index*4};
        const away={x:direction===1?W+40:-40,y:Math.max(24,roof.apex.y-Math.min(56,H*.15))-index*3};
        let position=target,stand=1,phase='perched',visible=age<duration,alpha=1;
        if(reduced)alpha=ease(age/2)*(1-ease((age-duration+2)/2));
        else if(age<landing){
          const t=ease((age-delay)/(landing-delay));phase='arriving';visible=age>=delay;stand=ease((t-.7)/.3);
          position=curve(entry,{x:entry.x+direction*W*.28,y:entry.y-12-index*2},{x:target.x-direction*(30+index*4),y:target.y-22},target,t);
          position.y+=Math.sin(Math.PI*t)*Math.sin(t*Math.PI*2+index*.9+seed)*3;
        }else if(age>=takeoff){
          const t=ease((age-takeoff)/(exit-takeoff));phase='departing';visible=age<exit&&age<duration;stand=1-ease(t/.3);
          position=curve(target,{x:target.x+direction*(26+index*3),y:target.y-24},{x:away.x-direction*W*.16,y:away.y+12},away,t);
          position.y+=Math.sin(Math.PI*t)*Math.sin(t*Math.PI*2+index*.8+seed)*3;
        }
        // Both feet, rather than only the body's center, touch the roof's two hypotenuses.
        const feet=[-.55,.55].map(dx=>({x:position.x+dx,y:position.y+stand*(roofY(target.x+dx)-target.y)}));
        return {character,x:position.x,y:position.y,feet,stand,phase,visible,alpha,direction,height:[7,7,6.6,5.7][index]};
      });
    }
    const rooftopPartySchedule=Object.freeze({interval:30,chance:.02,duration:24});
    function createRooftopPartyScheduler(random=Math.random){
      return {random,elapsed:0,untilOpportunity:rooftopPartySchedule.interval,active:null};
    }
    function advanceRooftopParty(state,dt,roofs=[],night=false){
      if(!state||!Number.isFinite(dt)||dt<=0)return state?.active||null;
      const step=dt;
      state.elapsed+=step;
      if(!night){
        state.active=null;
        state.untilOpportunity=rooftopPartySchedule.interval;
        return null;
      }
      if(state.active){
        if(!roofs.some(roof=>roof.index===state.active.roofIndex)){
          state.active=null;
          state.untilOpportunity=rooftopPartySchedule.interval;
          return null;
        }
        state.active.age+=step;
        if(state.active.age>=state.active.duration){
          state.active=null;
          state.untilOpportunity=rooftopPartySchedule.interval;
        }
        return state.active;
      }
      if(!roofs.length)return null;
      state.untilOpportunity-=step;
      if(state.untilOpportunity>0)return null;
      // Reset after one roll; long frames never replay the missed opportunities.
      state.untilOpportunity=rooftopPartySchedule.interval;
      if(state.random()>=rooftopPartySchedule.chance)return null;
      const slot=Math.floor(Math.min(.999999,clamp(state.random()))*roofs.length),roof=roofs[slot];
      state.active={roofIndex:roof.index,age:0,duration:rooftopPartySchedule.duration};
      return state.active;
    }
    function partyBeamPose(patio,time=0,fixture=0,frozen=false){
      const phase=Number(patio.partyPhase)||0,slot=fixture===0?.3:.7;
      const originX=patio.x+patio.bw*slot,originY=patio.y-2.2;
      const clock=frozen?0:Number(time)||0,scan=clock*1.2+phase+fixture*.43;
      const elevation=-1.1+.6*Math.sin(scan),length=Math.max(8,Math.min(15,patio.bh*.24));
      const direction=fixture===0?-1:1;
      const spread=Math.max(3,Math.min(5.2,length*.32));
      return {originX,originY,tipX:originX+direction*Math.cos(elevation)*length,tipY:originY+Math.sin(elevation)*length,length,elevation,spread,color:patio.partyColors?.[fixture%patio.partyColors.length]||'#ff65aa'};
    }
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
      if(e.type==='festival')return festival(e).y;
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
      return {x,y:groundAnchor(kind,x),direction,hop,distance:age*speed,...(kind==='walker'?{travel:{kind:'constant',startDistance:0,speed}}:{})};
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
      return {x,y:trail(x)+19,anchor,direction,travel:{startDistance:40,length:Math.abs((e.reverse?-80:W+80)-anchor),duration:Math.max(.001,Number(e.duration)||1)*(1-departureStart)},distance:40*arrival+Math.abs((e.reverse?-80:W+80)-anchor)*departure,pack:smooth(packStart,departureStart,f),stand:Math.max(1-arrival,smooth(standStart,departureStart,f)),walkAmount:Math.max(1-smooth(.08,.12,f),smooth(departureStart,departureStart+.03,f)),walking:f<.12||f>departureStart};
    }
    // A route's contact anchors are geometry, not animation history. Cache the
    // deterministic phase table so painting a crowd does not reintegrate its
    // traveled route on every frame; seeks construct the same table entries.
    const humanRoutes=new WeakMap(),humanGrounds=new Map(),humanRouteOrder=new Map();
    function humanGround(name,offset=0){
      const profiles={middle,near,trail},profile=profiles[name];
      if(!profile)throw new Error('Unknown human ground profile');
      const key=name+'|'+offset;
      if(!humanGrounds.has(key)){
        humanGrounds.set(key,x=>profile(x)+offset);
        if(humanGrounds.size>64)humanGrounds.delete(humanGrounds.keys().next().value);
      }
      return humanGrounds.get(key);
    }
    function humanRoute(x,distance,direction,ground,scale,travel){
      const origin=Math.round((x-direction*distance)*1e8)/1e8;
      const key=[origin,direction,scale,travel?.kind??'',travel?.speed??'',travel?.startDistance??'',travel?.length??'',travel?.duration??'',travel?.runStyle??''].join('|');
      let routes=humanRoutes.get(ground);
      if(!routes){routes=new Map();humanRoutes.set(ground,routes);}
      let route=routes.get(key);
      if(!route){
        const walkStrideAt=d=>{
          const at=origin+direction*d*scale;
          const grade=Math.max(...[-6,0,6].map(offset=>Math.abs(ground(at+(offset+.5)*scale)-ground(at+(offset-.5)*scale))/scale));
          // Plan contacts for a comfortable upright clearance, rather than
          // the emergency reach floor used only during steep transfers.
          const clearance=5.7,reachFloor=6.32;
          const extent=(-clearance*grade+Math.sqrt(reachFloor**2*(1+grade**2)-clearance**2))/(1+grade**2);
          return Math.min(10,extent/.3);
        };
        const speedAt=d=>{
          if(!travel)return 0;
          if(travel.kind==='constant')return travel.speed/scale;
          const progress=Math.max(0,Math.min(1,(d*scale-travel.startDistance)/travel.length));
          let low=0,high=1;
          for(let i=0;i<32;i++){const mid=(low+high)/2;if(mid*mid*(3-2*mid)<progress)low=mid;else high=mid;}
          const t=(low+high)/2;
          return travel.length/scale*6*t*(1-t)/travel.duration;
        };
        // Cap fast departures at a running contact rhythm. A longer aerial
        // stride does not lengthen either leg or change the existing route.
        const carrierAt=d=>{if(travel?.runStyle!=='carrying')return 0;const t=Math.max(0,Math.min(1,(d-travel.startDistance/scale)/12));return t*t*(3-2*t);};
        const strideAt=d=>Math.max(walkStrideAt(d),speedAt(d)*(.8-.3*carrierAt(d)));
        const density=d=>1/strideAt(d),approach=(travel?travel.startDistance:40)/scale;
        // Preserve the existing forty-unit approach's resting endpoint. Only
        // this route interval is normalized, never the entire viewport hill.
        let integral=0;
        for(let d=0;d<approach;d+=1){const end=Math.min(approach,d+1);integral+=(density(d)+density(end))*.5*(end-d);}
        const factor=integral?Math.ceil(integral-1e-9)/integral:1;
        const rate=(a,b)=>(density(a)+density(b))*.5*(b-a)*(b<=approach?factor:1);
        const nodes=[{distance:0,phase:0}];
        let phase=0;
        for(let d=-1;d>=-32;d--){phase-=rate(d,d+1);nodes.unshift({distance:d,phase});}
        route={nodes,rate,strideAt,walkStrideAt,carrierAt,approach,factor,clearances:new Map()};routes.set(key,route);
      }
      humanRouteOrder.delete(route);humanRouteOrder.set(route,{routes,key});
      if(humanRouteOrder.size>32){
        const [old,owner]=humanRouteOrder.entries().next().value;
        owner.routes.delete(owner.key);humanRouteOrder.delete(old);
      }
      const {nodes,rate}=route,target=distance/scale+36;
      while(nodes.at(-1).distance<target){
        const previous=nodes.at(-1),d=previous.distance;
        // Include the exact stop boundary in the integration table.
        const end=d<route.approach&&d+1>route.approach?route.approach:d+1;
        nodes.push({distance:end,phase:previous.phase+rate(d,end)});
      }
      const interpolate=(value,field,result)=>{
        // Running contacts can lie much farther ahead than a walking stride.
        // Extend on the requested axis instead of extrapolating an endpoint;
        // future seeks must never revise a previously reconstructed contact.
        if(!Number.isFinite(value))throw new RangeError('Human contact query must be finite');
        while(nodes.at(-1)[field]<value){
          const previous=nodes.at(-1),d=previous.distance;
          const end=d<route.approach&&d+1>route.approach?route.approach:d+1;
          nodes.push({distance:end,phase:previous.phase+rate(d,end)});
        }
        while(nodes[0][field]>value){
          const next=nodes[0],d=next.distance-1;
          nodes.unshift({distance:d,phase:next.phase-rate(d,next.distance)});
        }
        let low=0,high=nodes.length-1;
        while(high-low>1){const middle=(low+high)>>1;if(nodes[middle][field]>value)high=middle;else low=middle;}
        const a=nodes[low],b=nodes[high],t=(value-a[field])/(b[field]-a[field]);
        return a[result]+t*(b[result]-a[result]);
      };
      return {phaseAt:d=>interpolate(d,'distance','phase'),distanceAt:p=>interpolate(p,'phase','distance'),strideAt:route.strideAt,walkStrideAt:route.walkStrideAt,carrierAt:route.carrierAt,clearances:route.clearances};
    }
    function humanWalkPose(x,y,distance,direction,ground,carrying=false,scale=1,travel=null){
      // Terrain changes the spacing of future contacts, never an already
      // planted toe. World contact positions are reconstructed from the same
      // route origin and touchdown phase at every deterministic seek.
      const localDistance=distance/scale,route=humanRoute(x,distance,direction,ground,scale,travel);
      const cycles=route.phaseAt(localDistance),phase=cycles*Math.PI*2,stride=route.strideAt(localDistance);
      // Carrying is an actor capability, not the continuously changing grip.
      // Preserve approach/rest contacts and ease the departure plan in space.
      const extentAt=d=>{
        const at=x+direction*(d-localDistance)*scale;
        const grade=Math.max(...[-3,0,3].map(offset=>Math.abs(ground(at+(offset+.5)*scale)-ground(at+(offset-.5)*scale))/scale));
        const c=5.54,r=6.32;
        return (-c*grade+Math.sqrt(r*r*(1+grade*grade)-c*c))/(1+grade*grade);
      };
      const contactAt=p=>{
        const d=route.distanceAt(p),walk=.3*route.walkStrideAt(d),running=route.distanceAt(p+1)-d>walk/.3*1.15,amount=running?route.carrierAt(d):0;
        return {distance:d,extent:amount?walk+(extentAt(d)-walk)*amount:walk,amount};
      };
      const anchor=p=>{const c=contactAt(p);return c.distance+c.extent;};
      const stanceAt=p=>{
        const c=contactAt(p);
        if(!c.amount)return travel?Math.min(route.distanceAt(p+.6),c.distance+.6*route.walkStrideAt(c.distance)):route.distanceAt(p+.6);
        return Math.min(route.distanceAt(p+.6-.2*c.amount),c.distance+2*c.extent);
      };
      const stepAt=(d,offset)=>{
        const legPhase=route.phaseAt(d)+offset,cycle=Math.floor(legPhase),fraction=legPhase-cycle;
        const touchdownPhase=cycle-offset,touchdown=route.distanceAt(touchdownPhase),next=route.distanceAt(touchdownPhase+1);
        const start=anchor(touchdownPhase),end=anchor(touchdownPhase+1),walkStride=route.walkStrideAt(touchdown);
        const running=!!travel&&next-touchdown>walkStride*1.15;
        const stanceEnd=stanceAt(touchdownPhase),carrier=running?contactAt(touchdownPhase).amount:0;
        let position=start,lift=0;
        if(d>stanceEnd){
          const swing=(route.phaseAt(d)-route.phaseAt(stanceEnd))/(touchdownPhase+1-route.phaseAt(stanceEnd));
          const ease=swing*swing*(3-2*swing);
          if(!running)position=start+(end-start)*ease;
          else{
            // Fast flight carries the toes with the torso. Local leg reach
            // stays bounded; short contact buffers retain zero world toe
            // velocity at liftoff and touchdown instead of foot skating.
            const buffer=Math.min(.4,(next-stanceEnd)/4),oldX=start-stanceEnd,newX=end-next;
            let footX;
            if(d<stanceEnd+buffer){const t=(d-stanceEnd)/buffer;footX=oldX-buffer*(t-t*t/2);}
            else if(d>next-buffer){const t=(d-next+buffer)/buffer;footX=newX+buffer/2-buffer*t*t/2;}
            else{
              const a=route.phaseAt(stanceEnd+buffer),b=route.phaseAt(next-buffer),t=(route.phaseAt(d)-a)/(b-a),smooth=t*t*(3-2*t);
              footX=oldX-buffer/2+(newX+buffer/2-oldX+buffer/2)*smooth;
            }
            // A running recovery visibly travels behind and then ahead of the
            // pelvis; the envelope has zero displacement/velocity at contacts.
            footX-=2.4*carrier*Math.sin(2*Math.PI*swing)*Math.sin(Math.PI*swing)**2;
            position=d+footX;
          }
          lift=(.4+1.1*carrier)*Math.sin(swing*Math.PI)**2;
        }
        if(lift<1e-12)lift=0;
        return {position,lift,fraction,start,end,running,carrier,maxLift:.4+1.1*carrier,stanceEnd,touchdownPhase};
      };
      const feet=[0,.5].map(offset=>{
        const step=stepAt(localDistance,offset),footX=step.position-localDistance;
        const groundY=(ground(x+direction*footX*scale)-y)/scale;
        return {...step,footX,footY:groundY-step.lift,groundY};
      });
      // The torso remains vertical above the route. Lifting along the terrain
      // normal had put its pelvis downhill of both toes, producing a seated
      // silhouette even when the IK knees were almost straight.
      const hipX=0,slope=direction*(ground(x+.5*scale)-ground(x-.5*scale))/scale;
      // A smooth upright path must fit all real stance contacts, not a
      // prescribed fully extended height at every touchdown and mid-step.
      // Propagate their feasible clearance intervals in both directions;
      // this anticipates landing instead of snapping after a toe plants.
      const clearanceWindow=center=>{
        if(route.clearances.has(center))return route.clearances.get(center);
        const start=center-12,end=center+12,distances=[];
        for(let d=start;d<=end+1e-9;d+=.125)distances.push(d);
        const firstPhase=route.phaseAt(start),lastPhase=route.phaseAt(end);
        for(let cycle=Math.floor(firstPhase)-1;cycle<=Math.ceil(lastPhase)+1;cycle++)for(const p of [cycle,cycle+.1,cycle+.25,cycle+.35,cycle+.5,cycle+.6,cycle+.75,cycle+.85]){
          const d=route.distanceAt(p);if(d>start&&d<end)distances.push(d);
          if(travel&&(p===cycle||p===cycle+.5)){
            const lift=stanceAt(p);
            if(lift>start&&lift<end)distances.push(lift);
          }
        }
        distances.sort((a,b)=>a-b);
        const samples=distances.filter((d,i)=>!i||d-distances[i-1]>1e-8).map(d=>{
          const bodyX=x+direction*(d-localDistance)*scale,bodyGround=ground(bodyX)/scale,p=route.phaseAt(d);
          const steps=[0,.5].map(offset=>stepAt(d,offset));
          const contacts=steps.map(step=>{
            if(step.lift>0)return null;
            const contact=step.position,dx=contact-d;
            return {ground:ground(x+direction*(contact-localDistance)*scale)/scale,dx};
          }).filter(Boolean);
          const floor=Math.max(...contacts.map(foot=>foot.ground-Math.sqrt(Math.max(0,6.38**2-foot.dx**2))));
          let lo=5.32,hi=contacts.length?bodyGround-floor:7;
          for(const foot of contacts){
            if(Math.abs(foot.dx)>6.38)throw new Error('Human stance exceeds horizontal limb reach');
            const radius=Math.sqrt(6.38**2-foot.dx**2);
            lo=Math.max(lo,bodyGround-foot.ground-radius,bodyGround-foot.ground+.1);
          }
          const grade=Math.abs(ground(bodyX+.5*scale)-ground(bodyX-.5*scale))/scale;
          if(contacts.length&&grade<.2&&[0,.5].some(offset=>{const f=((p+offset)%1+1)%1;return f>=.25&&f<=.35;})){const extension=Math.max(...contacts.map(foot=>foot.ground-Math.sqrt(Math.max(0,6.12**2-foot.dx**2))));lo=Math.max(lo,bodyGround-extension);}
          // The same flight interval drives body rise and the toe recovery.
          // Solve the pelvis inside the contact corridor before deriving each
          // toe's required reach, rather than moving the body after the IK.
          let rise=0;
          if(!contacts.length&&steps.every(step=>step.running&&step.carrier>0)){
            const from=Math.max(...steps.map(step=>route.phaseAt(step.stanceEnd))),to=Math.min(...steps.map(step=>step.touchdownPhase+1));
            const t=Math.max(0,Math.min(1,(p-from)/(to-from)));
            rise=.55*16*t*t*(1-t)*(1-t)*Math.min(...steps.map(step=>step.carrier));
          }
          return {distance:d,lo,hi,target:6.25+rise};
        });
        const rate=.7;
        for(let i=1;i<samples.length;i++){
          const a=samples[i-1],b=samples[i],allowance=rate*(b.distance-a.distance);
          b.lo=Math.max(b.lo,a.lo-allowance);b.hi=Math.min(b.hi,a.hi+allowance);
        }
        for(let i=samples.length-2;i>=0;i--){
          const a=samples[i],b=samples[i+1],allowance=rate*(b.distance-a.distance);
          a.lo=Math.max(a.lo,b.lo-allowance);a.hi=Math.min(a.hi,b.hi+allowance);
        }
        for(const sample of samples){
          if(sample.lo>sample.hi+1e-7)throw new Error('Human contact plan has no upright clearance corridor');
          sample.clearance=Math.max(sample.lo,Math.min(sample.hi,sample.target));
        }
        route.clearances.set(center,samples);
        if(route.clearances.size>16)route.clearances.delete(route.clearances.keys().next().value);
        return samples;
      };
      const center=Math.floor(localDistance/4)*4;
      const clearanceAt=center=>{
        const samples=clearanceWindow(center);let low=0,high=samples.length-1;
        while(high-low>1){const middle=(low+high)>>1;if(samples[middle].distance>localDistance)high=middle;else low=middle;}
        const a=samples[low],b=samples[high],t=(localDistance-a.distance)/(b.distance-a.distance);
        return a.clearance+t*(b.clearance-a.clearance);
      };
      const blend=(localDistance-center)/4,clearance=clearanceAt(center)*(1-blend)+clearanceAt(center+4)*blend;
      const hipY=-clearance,bob=hipY+4.4;
      for(const foot of feet)if(foot.lift>0){
        const swingReach=6.4-.6*foot.lift/foot.maxLift;
        if(Math.abs(foot.footX)>swingReach)throw new Error('Human swing exceeds horizontal limb reach');
        const radius=Math.sqrt(swingReach**2-foot.footX**2);
        foot.footY=Math.max(hipY-radius,Math.min(foot.footY,hipY+radius));
        foot.lift=foot.groundY-foot.footY;
      }
      const legs=feet.map(({footX,footY,lift})=>{
        const dx=footX-hipX,dy=footY-hipY,d=Math.hypot(dx,dy);
        if(d>6.4+1e-8)throw new Error('Human limb endpoint is unreachable');
        const bend=Math.sqrt(Math.max(0,3.2**2-d*d/4));
        return {footX,footY,lift,kneeX:hipX+dx/2+dy/d*bend,kneeY:hipY+dy/2-dx/d*bend};
      });
      const arms=[0,.5].map(offset=>{
        const swing=strideArm(cycles,1,offset);
        return {x:hipX+swing.x,y:-8+bob+swing.y};
      });
      // Gathering reaches the grip before the object appears; switching a
      // carrying boolean at that frame would visibly snap the forearm.
      const grip=Math.max(0,Math.min(1,Number(carrying)||0));
      const hand=grip===1?{x:hipX+4,y:-3+bob}:{x:arms[0].x+(hipX+4-arms[0].x)*grip,y:arms[0].y+(-3+bob-arms[0].y)*grip};
      return {bob,hipX,hipY,legs,arms,hand,carrying,stride,locomotion:feet.some(foot=>foot.running)?'run':'walk'};
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
      // Match the stance's backward local velocity at both contacts. World
      // toe velocity is then zero as the foot lifts or settles, rather than
      // reversing abruptly; squared sine also removes the vertical snap.
      return {x:(-.3-.4*swing+3*swing*swing-2*swing*swing*swing)*stride,lift:Math.sin(swing*Math.PI)**2*2};
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
      const softDepth=Math.max(30,H*.12),softMax=.36,contactDepth=16,alpha=.47+night*.09;
      return {axisY:waterTop,alpha,softDepth,softMax,contactDepth,
        mirrorY:y=>2*waterTop-y,
        softness:depth=>Math.min(softMax,Math.max(0,depth)/softDepth*softMax),
        contactAlpha:depth=>{const q=clamp(depth/contactDepth);return alpha+(1-alpha)*(1-q*q*(3-2*q));}};
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
      const highSun=source==='sun'?clamp((altitude-12)/33):0;
      // The perspective ground plane made even a high Sun stretch tall trees
      // across the path. Ease only direct sunlight toward a small contact pool;
      // keep a nonzero ray so it still points away from the painted Sun.
      const directLength=Math.min(Math.max(3,height),
        Math.max(3,height)*.75/Math.tan(altitude*Math.PI/180));
      const length=source==='stars'?0:source==='sun'
        ?Math.max(1.5,directLength*(1-.94*highSun*highSun*(3-2*highSun))):directLength;
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
    function festival(event){
      const duration=Math.max(1,Number(event.duration)||150),progress=routeProgress({...event,type:'festival'},'x');
      const lane=Number.isFinite(Number(event.lane))?Number(event.lane):.5;
      const cruise=vessel('cruise',lane,W/2,event.age||0,event.reverse),scale=cruise.scale;
      const width=72*scale,height=28*scale,margin=width+28*scale;
      // Launch coordinates and painted rack dimensions share this scaled
      // geometry so every shell starts on the visible deck.
      const launcherOffset=56*.49*scale,launcherTop=-height*.21,launcherBottom=-height*.10;
      const launcherPadOffsets=[0,5*scale,10*scale];
      const direction=event.reverse?-1:1,x=-margin+(event.reverse?1-progress:progress)*(W+2*margin);
      // It is a vessel: complete physical entry/exit replaces a setup fade,
      // while a small bob leaves the hull comfortably inside the shallow lake.
      const y=waterTop+Math.min(9,Math.max(2,(shore-waterTop)*.25))+Math.sin((event.age||0)*.8)*.3*scale;
      return {x,y,width,height,scale,hullDepth:3*scale,direction,launcherOffset,
        launcherTop,launcherBottom,launcherRailWidth:2*scale,launcherPadRadius:1.2*scale,launcherPadOffsets,
        velocity:direction*(W+2*margin)/duration,alpha:1,
        beamAngle:Math.sin((event.age||0)*.16)*.24,crowdPhase:(event.age||0)*2.1};
    }
    function bannerLayout(text,planeX,planeY,direction,measureText){
      const maxWidth=Math.max(64,Math.min(144,W*.44)),padding=8,fontSize=7,maxTextWidth=maxWidth-padding;
      const measure=value=>{
        try{const width=Number(measureText(value,fontSize));return Number.isFinite(width)&&width>=0?width:Infinity;}
        catch{return Infinity;}
      };
      const words=String(text??'').trim().split(/\s+/).filter(Boolean),lines=[];let line='';
      for(const word of words){
        const candidate=line?line+' '+word:word;
        if(measure(candidate)<=maxTextWidth){line=candidate;continue;}
        if(line){lines.push(line);line='';}
        if(measure(word)<=maxTextWidth){line=word;continue;}
        let fragment='';
        for(const character of Array.from(word)){
          const next=fragment+character;
          if(fragment&&measure(next)>maxTextWidth){lines.push(fragment);fragment=character;}
          else fragment=next;
        }
        line=fragment;
      }
      if(line||!lines.length)lines.push(line);
      const textWidth=Math.max(0,...lines.map(measure)),width=Math.min(maxWidth,Math.max(64,Math.ceil(textWidth+padding)));
      const lineHeight=fontSize*1.25,height=Math.max(12,Math.ceil(lines.length*lineHeight+4)),y=planeY+3;
      const x=planeX-direction*(47+width/2);
      return {x,y,width,height,fontSize,lineHeight,lines,direction,
        towStartX:planeX-direction*18,towStartY:planeY,towEndX:x+direction*width/2,towEndY:y};
    }
    function fireworks(age,seed,atFestival=false,event={}){
      const dots=[],visitDuration=Number(event.duration)||(atFestival?150:60),duration=atFestival?visitDuration:Math.min(60,visitDuration);
      if(age<=0||age>=duration)return dots;
      const start=atFestival?8:0,interval=atFestival?3.8:2.1,shellLife=1+.075+2.7,pairLife=shellLife+.3;
      // Finish the barge display while its launchers are still on screen.
      // Reserve the full flight and bloom lifetime before the standalone limit or crossing-relative barge finale.
      // Widen from a mirrored pair to three positions, then a five-shell crown.
      // The opening pair expires before the crown blooms: overlapping volleys
      // retain the eight-shell paint budget and the complete natural ember tails.
      const crownAt=atFestival?Math.min(visitDuration*.65,duration-shellLife):duration-4;
      const finaleAt=crownAt-3.35;
      const count=Math.max(0,Math.floor((finaleAt-pairLife-start)/interval)+1);
      // Only shells still in flight need geometry, through the final fade.
      const first=Math.max(0,Math.floor((age-start-pairLife)/interval)+1),last=Math.min(count-1,Math.floor((age-start)/interval)),shells=[];
      // An independent seeded sample delays only the second regular shell.
      // No mutable random stream or timer can drift between devices or repaint.
      const pairDelay=wave=>{
        let hash=2166136261;
        for(const character of `${seed}|firework-pair|${wave}`)hash=Math.imul(hash^character.charCodeAt(0),16777619);
        hash=Math.imul(hash^(hash>>>16),0x7feb352d);hash=Math.imul(hash^(hash>>>15),0x846ca68b);
        return ((hash^(hash>>>16))>>>0)/4294967296*.3;
      };
      for(let wave=first;wave<=last;wave++)for(let lane=0;lane<2;lane++)shells.push({launch:start+wave*interval+(lane?pairDelay(wave):0),burst:wave*2+lane,wave,lane,finale:false});
      const volleys=[{delay:0,positions:[.35,.65]},{delay:2,positions:[.25,.5,.75]},{delay:3.35,positions:[.15,.325,.5,.675,.85]}];
      let finaleShell=0;
      for(const volley of volleys)for(const position of volley.positions){
        const lane=finaleShell++,launch=finaleAt+volley.delay;
        if(age>=launch&&age<launch+shellLife)shells.push({launch,burst:count*2+lane,wave:count,lane,finale:true,position});
      }
      for(const shell of shells){
        const {launch,burst,wave,lane,finale,position}=shell,time=age-launch;
        if(time<=0||time>=shellLife)continue;
        const deck=atFestival?festival({...event,age:event.fireworkDeckAge??launch}):null;
        const originX=deck?deck.x+((wave+lane)%2?1:-1)*deck.launcherOffset
          :finale?W*position:W*(.25+seed*.3+(wave%3)*.13+lane*.07);
        if(originX<3||originX>W-3)continue;
        const launchY=deck?deck.y-deck.height*.10:waterTop-2;
        // Waterfront bursts retain visible mirrored sparks. Each shell takes
        // its launch position and velocity from the deck at ignition; moving
        // the ship later cannot drag an already airborne bloom across the sky.
        // A short landscape viewport has a shallow lake. Keep its bloom low
        // enough to mirror visible sparks after the launch deck shrinks.
        const rise=Math.max(10,Math.min(horizon*.6,(far(originX)-waterTop)*1.05));
        const cy=waterTop-rise,vx=deck?.velocity||0;
        // Barge shells fan from real launchers; standalone shells use the same
        // positions directly. Regular flights keep their original trajectory.
        const fan=deck&&finale?Math.max(56,Math.min(W-56,W*position))-originX-vx:0;
        const drift=t=>vx*(t<1?t:1+.4*(1-Math.exp(-(t-1)*.9)));
        if(time<1){
          const flight=t=>({x:originX+drift(t)+fan*(1-(1-t)**2),y:launchY+(cy-launchY)*(1-(1-t)**2)});
          const tip=flight(time),tail=flight(Math.max(0,time-.13));
          dots.push({kind:'rocket',...tip,tailX:tail.x,tailY:tail.y,alpha:Math.min(1,time/.25)*Math.min(1,(1-time)/.16),burst,finale});
          continue;
        }
        const t=time-1,radius=Math.min(48,rise*.55),willow=burst%3===2;
        for(let i=0;i<40;i++){
          const noise=unit(Math.sin((i+1)*127.1+seed*311.7+burst*17.3)*43758.5453);
          const lag=noise*.075,life=2.15+noise*.55,age=t-lag;
          if(age<=0||age>=life)continue;
          const angle=i*Math.PI/20+seed*6+(noise-.5)*.11,speed=radius*(.48+.52*noise);
          const position=at=>{
            const travel=speed*(1-Math.exp(-at*1.55));
            return {x:originX+drift(1+at+lag)+fan+Math.cos(angle)*travel,
              y:Math.min(launchY-1,cy+Math.sin(angle)*travel*(willow?.8:1)+at*at*(willow?5:3))};
          };
          const alpha=Math.min(1,age/.2)*(1-age/life)**1.25,tip=position(age),trail=[];
          for(let k=0;k<6;k++){
            const at=Math.max(0,age-(5-k)*.105),point=position(at);
            trail.push({...point,alpha:alpha*(.10+.9*k/5)});
          }
          dots.push({kind:'spark',...tip,tailX:trail[0].x,tailY:trail[0].y,trail,alpha,burst,finale,willow,size:.7+noise*.65});
        }
      }
      return dots;
    }
    const sunReflection=sun=>sun.visible&&sun.altitude>0;
    const ripple=(i,t,wind=1)=>({alpha:.15+.75*(.5+.5*Math.sin(t*wind*1.3+i*1.71))**2,drift:Math.sin(t*wind*.5+i)*9,width:.65+.35*Math.sin(t*.9+i)**2});
    // Fine crossing ripple packets mostly compress reflected height. Their
    // weak sideways component avoids rubbery building edges; this numerical
    // twin keeps the GPU field testable at every viewport and frame time.
    const reflectionMotion=(x,depth,t,wind=1,frozen=false)=>{
      if(frozen||depth<=0)return {dx:0,dy:0};
      const phase=t*Math.max(.35,Number(wind)||1),q=Math.min(1,Math.max(0,depth)/28);
      const envelope=q*q*(3-2*q)*(.25+.75*Math.min(1,Math.max(0,depth)/110));
      const warp=.6*Math.sin(x*.034+depth*.051+phase*.23);
      const packet=Math.sin(depth*.49+x*.022-phase*1.11+warp);
      const detail=Math.sin(depth*.91-x*.047+phase*1.39+.35*Math.sin(x*.015+depth*.037-phase*.31));
      const field=packet*.68+detail*.32;
      return {dx:envelope*(.33*field+.1*Math.sin(x*.071+depth*.24-phase*.63)),dy:envelope*1.25*field};
    };
    return {routeProgress,motionProgress,motionAge,verticalOffset,visitPose,humanWalkPose,humanGround,woodlandPose,duckPose,waterDepth,cycleLeg,deerLeg,nestVisit,eventDepth,dogPose,skater,festival,bannerLayout,fireworks,flock,dolphin,starReflection,reflectionSurface,reflectionMotion,castShadow,grassBand,sunReflection,depthBand,groundAnchor,groundTravelX,groundPose,strideArm,strideFoot,wingFold,balloonDrift,vessel,foregroundTree,nest,ripple,skyPoint,horizon,waterTop,far,middle,near,rail,trail,lowerRail,railCars,tangent,rider,pack,cityscape,partyBeamPose,rooftopPartySchedule,createRooftopPartyScheduler,advanceRooftopParty,clocktowerRoof,clocktowerVisitSchedule,createClocktowerVisitScheduler,advanceClocktowerVisit,clocktowerVisitPoses};
  }
  root.LandscapeGeometry={create};
})(globalThis);
