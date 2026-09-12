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
    const pack=(x,count,reverse=false)=>Array.from({length:count},(_,i)=>rider(x-i*21*(reverse?-1:1),1,reverse));
    const waterTop=horizon+15,shore=horizon+H*.095;
    function vessel(kind,lane,x,t=0,reverse=false){
      const depth=Math.max(1,shore-waterTop),direction=reverse?-1:1;
      const scale=Math.min(kind==='cruise'?1:.95,W/600,depth/38);
      const y=waterTop+depth*(.38+Math.max(0,Math.min(1,lane))*.30)+Math.sin(t*.8+lane*6)*scale*.5;
      return {x,y,scale,direction,visible:depth>10};
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
    const ripple=(i,t,wind=1)=>({alpha:.15+.75*(.5+.5*Math.sin(t*wind*1.3+i*1.71))**2,drift:Math.sin(t*wind*.5+i)*9,width:.65+.35*Math.sin(t*.9+i)**2});
    return {depthBand,groundAnchor,groundTravelX,groundPose,strideFoot,wingFold,balloonDrift,vessel,foregroundTree,nest,ripple,horizon,waterTop,far,middle,near,rail,trail,lowerRail,tangent,rider,pack};
  }
  root.LandscapeGeometry={create};
})(globalThis);
