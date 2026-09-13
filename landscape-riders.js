/* Small wheeled visitors share the same route, scale and exit contract. */
(function(root){
  'use strict';
  const types=Object.freeze(['hoverboard','scooter']);
  function pose(event,geometry,W){
    const progress=Math.max(0,Math.min(1,event.age/event.duration)),direction=event.reverse?-1:1;
    const x=-160+(event.reverse?1-progress:progress)*(W+320);
    return {...geometry.skater(x,event.reverse),scale:W<600?.85:1,direction};
  }
  function paint(g,geometry,W,event,t,p,{ellipse,line,color,skinColor,personHead}){
    const q=pose(event,geometry,W),skin=skinColor(event.seed),shirt=color(event.seed),scooter=event.type==='scooter';
    g.save();g.translate(q.x,q.y);g.rotate(q.angle);g.scale(q.direction*q.scale,q.scale);
    if(scooter){
      ellipse(g,-5,-1.3,1.3,1.3,p.city);ellipse(g,6,-1.3,1.3,1.3,p.city);
      line(g,-6,-3,6,-3,color(event.seed,2),1.5);line(g,6,-3,5,-13,p.city,1.1);line(g,3,-13,7,-13,color(event.seed,2),1.2);
      // One foot stays planted while the other pushes and recovers. No knee
      // ever crosses backwards through its hip; ankles remain above the path.
      const push=Math.max(0,Math.sin(t*2.3)),back=-3-push*4,lift=Math.max(0,-Math.sin(t*2.3))*2;
      line(g,-1,-8,1,-6,p.city,1.3);line(g,1,-6,1,-3.7,p.city,1.3);
      line(g,-1,-8,-3,-5,p.city,1.3);line(g,-3,-5,back,-.7-lift,p.city,1.3);
      line(g,back-1,-.7-lift,back+1,-.7-lift,shirt,1.1);
      line(g,-1,-8,0,-14,shirt,2.7);line(g,0,-13,3,-11,skin,1.1);line(g,3,-11,5,-13,skin,1.1);
    }else{
      ellipse(g,-4,-1.4,1.4,1.4,p.city);ellipse(g,4,-1.4,1.4,1.4,p.city);line(g,-4,-2.5,4,-2.5,color(event.seed,2),2);
      for(const side of [-1,1]){line(g,0,-8,side*2,-5.5,p.city,1.3);line(g,side*2,-5.5,side*2.5,-3.5,p.city,1.3);}
      line(g,0,-8,0,-14,shirt,2.7);line(g,0,-13,-4,-10+Math.sin(t)*.4,skin,1.1);line(g,0,-13,4,-10-Math.sin(t)*.4,skin,1.1);
    }
    personHead(g,0,-17,1.9,1.9,event.seed,skin,true);ellipse(g,0,-18,2.2,1.2,color(event.seed,2));g.restore();
  }
  root.LandscapeRiders=Object.freeze({types,pose,paint});
})(globalThis);
