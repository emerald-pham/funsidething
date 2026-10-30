/* A small stroke alphabet lets the aircraft follow the actual letters instead
   of revealing a typeset label. All paths are local geometry, with no fonts or
   generated words fetched from a service. Coordinates use a 6 by 8 grid. */
(function(root){
  'use strict';
  const glyphs={
    A:[[[0,8],[3,0],[6,8]],[[1.5,4],[4.5,4]]],
    B:[[[0,8],[0,0],[4,0],[6,1],[6,3],[4,4],[0,4]],[[4,4],[6,5],[6,7],[4,8],[0,8]]],
    C:[[[6,1],[4,0],[1,0],[0,2],[0,6],[1,8],[4,8],[6,7]]],
    D:[[[0,8],[0,0],[3,0],[6,2],[6,6],[3,8],[0,8]]],
    E:[[[6,0],[0,0],[0,8],[6,8]],[[0,4],[5,4]]],
    F:[[[6,0],[0,0],[0,8]],[[0,4],[5,4]]],
    G:[[[6,1],[4,0],[1,0],[0,2],[0,6],[1,8],[5,8],[6,6],[6,4],[3,4]]],
    H:[[[0,0],[0,8]],[[0,4],[6,4]],[[6,0],[6,8]]],
    I:[[[0,0],[6,0]],[[3,0],[3,8]],[[0,8],[6,8]]],
    J:[[[0,0],[6,0],[6,6],[4,8],[1,8],[0,6]]],
    K:[[[0,0],[0,8]],[[6,0],[0,4],[6,8]]],
    L:[[[0,0],[0,8],[6,8]]],
    M:[[[0,8],[0,0],[3,4],[6,0],[6,8]]],
    N:[[[0,8],[0,0],[6,8],[6,0]]],
    O:[[[3,0],[1,0],[0,2],[0,6],[1,8],[5,8],[6,6],[6,2],[5,0],[3,0]]],
    P:[[[0,8],[0,0],[4,0],[6,2],[6,3],[4,4],[0,4]]],
    Q:[[[3,0],[1,0],[0,2],[0,6],[1,8],[5,8],[6,6],[6,2],[5,0],[3,0]],[[4,6],[7,9]]],
    R:[[[0,8],[0,0],[4,0],[6,2],[6,3],[4,4],[0,4]],[[3,4],[6,8]]],
    S:[[[6,1],[4,0],[1,0],[0,2],[1,4],[5,4],[6,6],[5,8],[1,8],[0,7]]],
    T:[[[0,0],[6,0]],[[3,0],[3,8]]],
    U:[[[0,0],[0,6],[1,8],[5,8],[6,6],[6,0]]],
    V:[[[0,0],[3,8],[6,0]]],
    W:[[[0,0],[1,8],[3,4],[5,8],[6,0]]],
    X:[[[0,0],[6,8]],[[6,0],[0,8]]],
    Y:[[[0,0],[3,4],[6,0]],[[3,4],[3,8]]],
    Z:[[[0,0],[6,0],[0,8],[6,8]]],
  };
  function wordPath(word){
    if(typeof word!=='string'||!/^[a-z]{1,16}$/i.test(word))return null;
    const legs=[];let previous=null,total=0;
    for(const [index,letter] of [...word.toUpperCase()].entries())for(const stroke of glyphs[letter]){
      for(let i=0;i<stroke.length;i++){
        const point=[stroke[i][0]+index*9,stroke[i][1]];
        if(previous){const length=Math.hypot(point[0]-previous[0],point[1]-previous[1]);if(length){legs.push({from:previous,to:point,length,ink:i>0});total+=length;}}
        previous=point;
      }
    }
    return {legs,total,width:word.length*9-3};
  }
  function trace(path,progress){
    const fraction=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
    let remaining=path.total*fraction,x=path.legs[0].from[0],y=path.legs[0].from[1],angle=0;
    const segments=[];
    for(const leg of path.legs){
      const amount=Math.min(1,remaining/leg.length);
      x=leg.from[0]+(leg.to[0]-leg.from[0])*amount;y=leg.from[1]+(leg.to[1]-leg.from[1])*amount;
      angle=Math.atan2(leg.to[1]-leg.from[1],leg.to[0]-leg.from[0]);
      if(leg.ink&&amount>0)segments.push([leg.from,[x,y]]);
      remaining-=leg.length;if(remaining<=0)break;
    }
    return {segments,x,y,angle,complete:fraction===1};
  }
  root.LandscapeSkywriter=Object.freeze({wordPath,trace});
})(globalThis);
