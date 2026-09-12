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
    return {horizon,waterTop:horizon+15,far,middle,near,rail,trail,lowerRail,tangent,rider,pack};
  }
  root.LandscapeGeometry={create};
})(globalThis);
