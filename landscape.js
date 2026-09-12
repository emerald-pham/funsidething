/* Two canvases: the painted landscape is cached, only its sparse inhabitants
   redraw at 24fps. Device motion preference never enters the synced task state. */
(function(){
  'use strict';
  const S=globalThis.LivingSky,host=document.getElementById('landscape');
  if(!host||!S)return;
  const back=host.querySelector('[data-scenery]'),front=host.querySelector('[data-life]');
  let b=back.getContext('2d',{alpha:false});const base=b,g=front.getContext('2d');
  const layers={};let geometry;
  if(!b||!g){host.hidden=true;return;}
  const mq=window.matchMedia('(prefers-reduced-motion: reduce)');
  let storage;try{storage=window.localStorage;}catch{storage=null;}
  let preference=S.readMotion(storage),reduced=S.motionReduced(preference,mq.matches);
  let W=0,H=0,hy=0,dpr=1,frame=0,last=0,lastPaint=0,sky,p,world=S.createWorld();
  let skyTimer=0,resizeTimer=0,returnFocus=null,sunDay=null,sunTimes=null;
  const dialog=document.getElementById('motionDialog');
  const status=document.getElementById('sceneStatus');
  const motionButton=document.getElementById('motionButton');
  const TAU=Math.PI*2,visitSeed=Math.random(),wind=.6+Math.random()*1.2;
  const rand=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
  const far=x=>geometry.far(x),middle=x=>geometry.middle(x),near=x=>geometry.near(x);
  const rail=x=>geometry.rail(x),trail=x=>geometry.trail(x);
  const colors=['#db947e','#a4c9bd','#e6c680','#ada9ce','#88b9cf','#e8b6c4'];
  const color=(seed,offset=0)=>S.mixHex(colors[Math.floor((seed*97+offset)%colors.length)],p.front,p.night*.35);
  function layer(name,top){
    const canvas=layers[name]||(layers[name]=document.createElement('canvas'));
    canvas.width=Math.floor(W*dpr);canvas.height=Math.max(1,Math.ceil((H-top)*dpr));canvas.top=top;
    b=canvas.getContext('2d');b.setTransform(dpr,0,0,dpr,0,-top*dpr);
  }
  function composite(name){const c=layers[name];if(c)g.drawImage(c,0,c.top,c.width/dpr,c.height/dpr);}
  const point=(az,alt)=>({x:az/360*W,y:hy-(Math.max(alt,-2)/90)*(hy-22)});
  function path(ctx,fn,start=0,end=W,step=12){ctx.beginPath();ctx.moveTo(start,fn(start));for(let x=start+step;x<end;x+=step)ctx.lineTo(x,fn(x));ctx.lineTo(end,fn(end));}
  function hill(ctx,fn,color){path(ctx,fn);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
  function ellipse(ctx,x,y,rx,ry,color){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fillStyle=color;ctx.fill();}
  function line(ctx,x,y,x2,y2,color,width=1){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function tree(ctx,x,y,size,color,variant=0){
    ellipse(ctx,x,y+1,size*.22,2,S.mixHex(color,p.front,.5));
    line(ctx,x,y,x-1,y-size*.8,S.mixHex(color,'#283f33',.4),Math.max(1,size*.07));
    if(variant<.25){
      for(let k=0;k<3;k++){
        ctx.beginPath();ctx.moveTo(x,y-size*(1.2-k*.22));ctx.lineTo(x-size*(.23+k*.055),y-size*(.42-k*.18));ctx.lineTo(x+size*(.23+k*.055),y-size*(.42-k*.18));ctx.closePath();ctx.fillStyle=color;ctx.fill();
      }
    }else{
      ellipse(ctx,x-size*.12,y-size*.73,size*.32,size*.39,color);
      ellipse(ctx,x+size*.18,y-size*.83,size*.27,size*.32,color);
      ellipse(ctx,x,y-size*.99,size*.24,size*.27,color);
      line(ctx,x,y-size*.13,x+size*.17,y-size*.6,S.mixHex(color,'#5d6750',.3),1);
    }
  }
  function paintMoon(ctx){
    if(!sky.moon.visible)return;
    const q=point(sky.moon.azimuth,sky.moon.altitude),r=W<600?10:14;
    const alpha=.3+.7*p.night;
    ctx.save();ctx.globalAlpha=alpha;
    const glow=ctx.createRadialGradient(q.x,q.y,r*.7,q.x,q.y,r*5);
    glow.addColorStop(0,'rgba(237,243,215,.12)');glow.addColorStop(1,'rgba(237,243,215,0)');
    ctx.fillStyle=glow;ctx.fillRect(q.x-r*5,q.y-r*5,r*10,r*10);
    // Unlit lunar terrain disappears into daylight; do not paint a dark planet.
    if(p.night>.1){ctx.globalAlpha=alpha*.3;ellipse(ctx,q.x,q.y,r,r,S.mixHex(p.sky[0],'#415369',.45));ctx.globalAlpha=alpha;}
    const phase=sky.phase*Math.PI/180,sign=sky.phase<=180?1:-1;
    ctx.beginPath();
    for(let i=0;i<=40;i++){const y=-r+i*r/20,x=sign*Math.sqrt(Math.max(0,r*r-y*y));if(i===0)ctx.moveTo(q.x+x,q.y+y);else ctx.lineTo(q.x+x,q.y+y);}
    for(let i=40;i>=0;i--){const y=-r+i*r/20,x=sign*Math.cos(phase)*Math.sqrt(Math.max(0,r*r-y*y));ctx.lineTo(q.x+x,q.y+y);}
    ctx.closePath();ctx.fillStyle='#f4efd1';ctx.fill();ctx.clip();
    ellipse(ctx,q.x-3,q.y+4,3,2,'rgba(119,133,132,.16)');ellipse(ctx,q.x+5,q.y-4,2,3,'rgba(119,133,132,.15)');
    ctx.restore();
  }
  function paintBackground(){
    b=base;
    const gradient=b.createLinearGradient(0,0,0,hy+H*.12);
    p.sky.forEach((c,i)=>gradient.addColorStop(i/2,c));
    b.fillStyle=gradient;b.fillRect(0,0,W,H);
    const night=p.night;
    if(night>.05){
      for(const star of sky.stars){
        const q=point(star.azimuth,star.altitude);
        // Brightness, extinction and moonlight all affect what is visible.
        const moonlight=sky.moon.visible?sky.illumination*.32:0;
        b.globalAlpha=S.clamp(night*(1-moonlight)*(.9-star.magnitude*.12)*S.smooth(0,12,star.altitude));
        const color=star.colorIndex>1?'#ffdbab':star.colorIndex<0?'#d3eaff':'#f6f3df';
        ellipse(b,q.x,q.y,Math.max(.45,1.5-star.magnitude*.21),Math.max(.45,1.5-star.magnitude*.21),color);
      }
      b.globalAlpha=1;
    }
    if(sky.sun.altitude > -7){
      const q=point(sky.sun.azimuth,sky.sun.altitude),r=W<600?15:22;
      const glow=b.createRadialGradient(q.x,q.y,r*.2,q.x,q.y,Math.min(W*.35,270));
      glow.addColorStop(0,'rgba(255,236,179,.65)');glow.addColorStop(.2,'rgba(255,216,158,.22)');glow.addColorStop(1,'rgba(255,214,173,0)');
      b.fillStyle=glow;b.fillRect(0,0,W,hy+80);
      if(sky.sun.visible){ellipse(b,q.x,q.y,r,r,'#fff1be');ellipse(b,q.x,q.y,r*.8,r*.8,'#fff6d5');}
    }
    paintMoon(b);
    // Atmospheric ridge and a city whose small imperfections avoid a repeated skyline.
    hill(b,x=>hy+Math.sin(x/W*8)*12,S.mixHex(p.city,p.sky[2],.45));
    const count=Math.ceil(W/15);
    for(let i=0;i<count;i++){
      const x=i*W/count,cluster=.4+.6*Math.pow(Math.sin(x/W*Math.PI*3+.5),2);
      const bh=(18+rand(i+14)*65)*cluster*(W<600?.8:1),bw=7+rand(i+91)*18,y=hy+12-bh;
      b.fillStyle=S.mixHex(p.city,p.sky[2],rand(i+13)*.25);b.fillRect(x,y,bw,bh+15);
      if(rand(i+33)>.68){b.fillRect(x+bw*.25,y-5,bw*.5,6);line(b,x+bw*.5,y-5,x+bw*.5,y-12,p.city,.7);}
      for(let yy=y+5;yy<hy+8;yy+=7)for(let xx=x+3;xx<x+bw-2;xx+=5){
        b.fillStyle=night>.2 && rand(xx+yy)>.42?`rgba(255,220,153,${night*.8})`:'rgba(225,239,232,.22)';b.fillRect(xx,yy,1.6,2.7);
      }
    }
    // A small clock tower and civic dome give the distant city a recognizable heart.
    const tx=W*.71,ty=hy-72;
    b.fillStyle=p.city;b.fillRect(tx-9,ty,18,83);b.fillRect(tx-12,ty-4,24,5);
    b.beginPath();b.moveTo(tx-11,ty-4);b.lineTo(tx,ty-19);b.lineTo(tx+11,ty-4);b.fill();
    ellipse(b,tx,ty+12,5,5,S.mixHex('#fff0c9',p.city,.18));
    const hands=globalThis.LandscapeMood?.clock(sky.date)||{minuteAngle:0,hourAngle:0};
    line(b,tx,ty+12,tx+Math.sin(hands.minuteAngle)*4,ty+12-Math.cos(hands.minuteAngle)*4,'#577581',.9);
    line(b,tx,ty+12,tx+Math.sin(hands.hourAngle)*2.8,ty+12-Math.cos(hands.hourAngle)*2.8,'#577581',1.2);
    const water=b.createLinearGradient(0,geometry.waterTop,0,hy+H*.18);
    water.addColorStop(0,S.mixHex(p.sky[2],p.sky[0],.35));water.addColorStop(1,S.mixHex(p.sky[1],p.front,.3));
    b.fillStyle=water;b.fillRect(0,geometry.waterTop,W,H);
    for(let i=0;i<90;i++){
      const x=rand(i+44)*W,y=geometry.waterTop+rand(i+79)*H*.12;
      line(b,x,y,x+8+rand(i)*28,y,S.mixHex(p.sky[2],p.city,.18),.6);
      if(night>.4&&i%3===0)line(b,x,geometry.waterTop,x+2,y,'rgba(255,220,163,.16)',2);
    }
    hill(b,far,p.far);
    // Viaduct, stations and catenary are below the skyline, behind the cycle hills.
    for(let x=15;x<W;x+=65){line(b,x,rail(x)+3,x,rail(x)+55,S.mixHex(p.city,p.far,.4),5);}
    path(b,rail);b.strokeStyle=S.mixHex(p.city,'#d6d6bb',.45);b.lineWidth=8;b.stroke();
    path(b,x=>rail(x)-4);b.strokeStyle=S.mixHex(p.city,'#334d4a',.3);b.lineWidth=1.2;b.stroke();
    for(let x=35;x<W;x+=140){line(b,x,rail(x)-4,x,rail(x)-25,p.city,.8);line(b,x-8,rail(x)-25,x+12,rail(x)-25,p.city,.8);}
    path(b,x=>rail(x)-24);b.strokeStyle=p.city;b.lineWidth=.5;b.stroke();
    layer("middle",Math.max(0,hy+H*.14-85));
    hill(b,middle,p.hill);
    // Long, gentle contour bands give the hills volume without texture downloads.
    for(let i=0;i<3;i++){path(b,x=>middle(x)+15+i*8);b.strokeStyle=`rgba(225,236,184,${.055*(1-night)})`;b.lineWidth=3;b.stroke();}
    path(b,trail);b.strokeStyle=S.mixHex(p.hill,'#d7cbaa',.72);b.lineWidth=11;b.stroke();
    path(b,trail);b.strokeStyle=S.mixHex(p.hill,'#f3e7bf',.66);b.lineWidth=7;b.stroke();
    b.setLineDash([9,18]);path(b,trail);b.strokeStyle='rgba(255,250,219,.45)';b.lineWidth=.7;b.stroke();b.setLineDash([]);
    for(let i=0;i<35;i++){
      const x=rand(i+200)*W,y=middle(x)+2,size=12+rand(i+300)*25;
      if(Math.abs(x-geometry.nest().treeX)>32)tree(b,x,y,size,S.mixHex(p.hill,p.front,.6),rand(i+10));
    }
    if(W>650){
      // A short secondary walking loop rejoins the main path; it never crosses rails.
      path(b,x=>trail(x)+Math.sin((x-W*.3)/(W*.25)*Math.PI)*22,W*.3,W*.55);
      b.strokeStyle=S.mixHex(p.hill,'#eedcba',.65);b.lineWidth=4;b.stroke();
      if(visitSeed>.25){
        const ax=W*.43,ay=trail(ax)+15;
        b.fillStyle=color(visitSeed);b.fillRect(ax-9,ay-12,18,12);
        for(let i=0;i<4;i++){b.fillStyle=i%2?'#fff0d6':color(visitSeed,2);b.fillRect(ax-11+i*5.5,ay-16,5.5,5);}
        ellipse(b,ax,ay-7,2,2,'#fff0d6');b.fillStyle='#c39877';b.fillRect(ax-1,ay-5,2,3);
      }
      if(W>1000&&visitSeed<.75){
        const ax=W*.62,ay=trail(ax)+18;
        line(b,ax-6,ay,ax-6,ay-15,p.city,1.3);line(b,ax-8,ay-15,ax+8,ay-15,p.city,1.3);
        for(const dx of [-4,6]){b.beginPath();b.arc(ax+dx,ay-5,3,0,TAU);b.strokeStyle=p.city;b.lineWidth=1;b.stroke();}
        line(b,ax-4,ay-5,ax+1,ay-11,color(visitSeed),1.5);line(b,ax+1,ay-11,ax+6,ay-5,color(visitSeed),1.5);
      }
    }
    // The level foundation sits inside the hill; a short path joins its door.
    const house=geometry.cottage(),cx=house.x,cy=house.y;
    ellipse(b,cx+2,cy+1,22,3,S.mixHex(p.hill,p.front,.35));
    b.beginPath();b.moveTo(cx+1,cy);b.quadraticCurveTo(cx+6,cy+8,cx+3,trail(cx+3));b.strokeStyle=S.mixHex(p.hill,'#ecd9b7',.75);b.lineWidth=4;b.stroke();
    b.fillStyle=S.mixHex('#eedfc0',p.front,night*.55);b.fillRect(cx-16,cy-20,27,20);
    b.fillStyle=S.mixHex('#cdbb99',p.front,night*.55);b.beginPath();b.moveTo(cx+11,cy-20);b.lineTo(cx+19,cy-15);b.lineTo(cx+19,cy);b.lineTo(cx+11,cy);b.closePath();b.fill();
    b.fillStyle=S.mixHex('#a88070',p.front,night*.45);b.fillRect(cx+6,cy-32,4,11);
    b.beginPath();b.moveTo(cx-20,cy-20);b.lineTo(cx-3,cy-33);b.lineTo(cx+15,cy-20);b.closePath();b.fillStyle=S.mixHex('#c08e79',p.front,night*.45);b.fill();
    b.beginPath();b.moveTo(cx-3,cy-33);b.lineTo(cx+6,cy-29);b.lineTo(cx+23,cy-15);b.lineTo(cx+15,cy-20);b.closePath();b.fillStyle=S.mixHex('#9f7768',p.front,night*.45);b.fill();
    b.fillStyle=S.mixHex('#78948c',p.front,night*.5);b.fillRect(cx-2,cy-12,6,12);
    b.fillStyle=night>.3?'#f7d79d':'#9fced1';b.fillRect(cx-12,cy-15,6,7);
    line(b,cx-9,cy-15,cx-9,cy-8,'#f4e8d0',.7);line(b,cx-12,cy-11.5,cx-6,cy-11.5,'#f4e8d0',.7);
    line(b,cx-17,cy,cx+19,cy,S.mixHex('#b9af97',p.front,night*.5),2);
    const nest=geometry.nest();
    tree(b,nest.treeX,nest.ground,54,S.mixHex(p.hill,p.front,.8),.6);
    line(b,nest.treeX,nest.y+5,nest.x-3,nest.y+1,'#8e8065',1.1);
    b.beginPath();b.ellipse(nest.x,nest.y,4,2.3,0,0,Math.PI);b.fillStyle='#a28b67';b.fill();
    line(b,nest.x-4,nest.y,nest.x+4,nest.y,'#b6a080',.7);
    if(sky.sun.altitude<0){ellipse(b,nest.x-1.5,nest.y-1,1.5,1.2,p.front);ellipse(b,nest.x+1.5,nest.y-1,1.5,1.2,p.front);}
    for(let i=0;i<8;i++){const x=W*.18+i*7;line(b,x,trail(x)+17,x,trail(x)+6,S.mixHex('#d2c8ab',p.front,night*.7),1.2);}
    path(b,x=>trail(x)+10,W*.18,W*.18+49,7);b.strokeStyle=S.mixHex('#d2c8ab',p.front,night*.7);b.lineWidth=1;b.stroke();
    layer("front",Math.max(0,hy+H*.35));
    hill(b,near,p.front);
    // A lower rail line is distinct from the elevated metro.
    path(b,x=>near(x)+H*.07);b.strokeStyle=S.mixHex(p.front,'#b6b89c',.25);b.lineWidth=6;b.stroke();
    path(b,x=>near(x)+H*.07);b.strokeStyle=S.mixHex(p.front,'#c2c6aa',.38);b.lineWidth=1;b.stroke();
    layer("trees",Math.max(0,hy+H*.35-85));
    const planted=[];
    for(let i=0;i<25;i++){
      const x=rand(i+601)*W,y=geometry.foregroundTree(x,near(x)+10+rand(i+631)*100),size=23+rand(i+711)*47;
      if(planted.some(tree=>Math.abs(tree.x-x)<Math.max(tree.size,size)*.3&&Math.abs(tree.y-y)<22))continue;
      planted.push({x,y,size});
      tree(b,x,y,size,S.mixHex(p.front,'#183d32',.25),rand(i+910));
    }
    // Tiny wildflower groups and grasses are static; wind is confined to the overlay.
    for(let i=0;i<140;i++){
      const x=rand(i+900)*W,y=near(x)+30+rand(i+950)*(H-near(x));
      line(b,x,y,x-2,y-5,S.mixHex(p.front,'#b7c79b',.17),.7);
      if(rand(i+970)>.63)ellipse(b,x-2,y-5,1.4,1,S.mixHex('#e7c98a',p.front,night*.8));
    }
    const vignette=b.createLinearGradient(0,hy,0,H);vignette.addColorStop(0,'rgba(5,25,27,0)');vignette.addColorStop(1,'rgba(5,25,27,.035)');b.fillStyle=vignette;b.fillRect(0,hy,W,H-hy);
  }
  function cloud(x,y,size,opacity){
    g.globalAlpha=opacity;
    const color=S.mixHex('#f8f1dd',p.sky[1],.22+p.night*.62);
    g.beginPath();
    for(const [dx,dy,rx,ry] of [[0,0,1.8,.24],[-.6,-.18,.75,.35],[.2,-.25,.7,.46],[.9,-.09,.66,.27]]){
      g.moveTo(x+(dx+rx)*size,y+dy*size);g.ellipse(x+dx*size,y+dy*size,rx*size,ry*size,0,0,TAU);
    }
    g.fillStyle=color;g.fill();
    g.globalAlpha=1;
  }
  function bird(x,y,size,t,perched=false,twig=false){
    g.strokeStyle=S.mixHex('#314a45',p.sky[0],p.night*.6);g.lineWidth=1.2;g.lineCap='round';
    g.beginPath();g.moveTo(x-size,y-Math.abs(Math.sin(t*5))*size*.6);g.quadraticCurveTo(x-size*.4,y-size*.4,x,y);g.quadraticCurveTo(x+size*.5,y-size*.6,x+size,y-(perched?0:Math.abs(Math.sin(t*5+.3))*size*.6));g.stroke();
    if(twig&&!perched){line(g,x,y+1,x+6,y+4,'#8b745a',.7);line(g,x+3,y+2,x+5,y,'#8b745a',.6);}
  }
  function cyclist(x,y,t,color,scale=1,reverse=false){
    g.save();g.translate(x,y-3.6*scale);g.rotate(geometry.tangent(trail,x));g.scale((reverse?-1:1)*scale,scale);
    g.strokeStyle=S.mixHex('#253f3b',p.front,p.night*.35);g.lineWidth=1;
    for(const xx of [-5,6]){g.beginPath();g.arc(xx,0,3.6,0,TAU);g.stroke();line(g,xx,0,xx+Math.cos(t*6)*3,Math.sin(t*6)*3,g.strokeStyle,.5);}
    const k=Math.sin(t*6)*2;
    line(g,-5,0,-1,-5,color,1.3);line(g,-1,-5,2,0,color,1.3);line(g,2,0,-5,0,color,1.3);line(g,2,0,6,-5,color,1.3);line(g,6,-5,6,0,color,1);
    line(g,0,-5,1+k,-2,'#e5c7a4',1.5);line(g,1+k,-2,2,0,'#e5c7a4',1.2);line(g,-1,-6,1,-11,color,2.8);line(g,1,-10,5,-7,'#e5c7a4',1.2);ellipse(g,2,-13,2,2,'#e6c7a2');ellipse(g,2,-14,2.2,1.1,color);
    g.restore();
  }
  function transport(x,y,progress,isTrain,reverse){
    const track=isTrain?geometry.lowerRail:rail,n=isTrain?5:3,cw=isTrain?24:22,dir=reverse?-1:1;
    for(let i=0;i<n;i++){
      const xx=x-i*(cw+2)*dir;
      g.save();g.translate(xx,track(xx)-2);g.rotate(geometry.tangent(track,xx));g.scale(dir,1);
      g.fillStyle=S.mixHex(isTrain?'#e4cfa5':'#dceade',p.city,p.night*.3);g.beginPath();g.roundRect(-cw/2,-10,cw,8,2);g.fill();
      g.fillStyle=isTrain?'#bb8275':'#77a8a2';g.fillRect(-cw/2,-5,cw,2);
      g.fillStyle=p.night>.4?'#edce89':'#71969c';for(let j=3;j<cw-3;j+=5)g.fillRect(-cw/2+j,-8,3,2);
      ellipse(g,-cw/2+4,-1,1.5,1.5,p.city);ellipse(g,cw/2-4,-1,1.5,1.5,p.city);g.restore();
    }
  }
  function paintLife(t){
    g.clearRect(0,0,W,H);
    for(const e of world.events)if(e.type==='meteor'&&p.night>.3){
      const f=e.age/e.duration,dx=(e.reverse?-1:1)*(85+e.seed*70),dy=24+e.lane*20;
      const sx=W*(.2+e.seed*.6),sy=hy*(.08+e.lane*.3),x=sx+dx*f,y=sy+dy*f;
      g.save();g.globalAlpha=p.night*S.smooth(0,.08,f)*(1-S.smooth(.55,1,f));
      const tail=g.createLinearGradient(x-dx*.35,y-dy*.35,x,y);tail.addColorStop(0,'#e7f5ee00');tail.addColorStop(1,'#effbf5');
      line(g,x-dx*.35,y-dy*.35,x,y,tail,1.1);ellipse(g,x,y,1.2,1.2,'#f9ffe8');g.restore();
    }
    // Persistent drift guarantees life even between scheduled arrivals. In reduced
    // motion these exact same shapes are drawn once, with no animation loop.
    for(let i=0;i<7;i++){
      const size=(W<600?18:27)+rand(i+101)*30;
      const x=((rand(i+71)*W+t*wind*(1.2+rand(i+2)*1.5)+size*3)%(W+size*6))-size*3;
      cloud(x,25+rand(i+82)*(hy*.68),size,.22+rand(i+54)*.18);
    }
    g.save();path(g,far);g.lineTo(W,geometry.waterTop);g.lineTo(0,geometry.waterTop);g.closePath();g.clip();
    const reflection=point((sky.sun.visible?sky.sun:sky.moon).azimuth,0).x;
    for(let i=0;i<24;i++){
      const wave=geometry.ripple(i,t,wind),y=geometry.waterTop+5+i*H*.0035,w=(5+i*1.9)*wave.width;
      const x=reflection+wave.drift;
      g.globalAlpha=(sky.sun.visible?.7:sky.moon.visible?.35:0)*(1-i/28)*wave.alpha;
      line(g,x-w,y,x+w,y,p.night>.4?'#e2ecdc':'#fff6d7',1);
    }
    for(let i=0;i<40;i++){
      const wave=geometry.ripple(i+30,t,wind),x=rand(i+403)*W+wave.drift,y=geometry.waterTop+rand(i+402)*H*.09;
      g.globalAlpha=wave.alpha*.20;line(g,x,y,x+(7+rand(i+480)*22)*wave.width,y,S.mixHex(p.sky[1],'#ffffff',.6),.8);
    }g.restore();
    for(const e of world.events)if(['jetski','sailboat','cruise','yacht'].includes(e.type))paintVessel(e,t);
    const airborne=new Set(['metro','duck','fish','plane','balloon','airshow','banner','hangglider','jetski','sailboat','cruise','yacht']);
    for(const e of world.events)if(airborne.has(e.type))paintEvent(e,t);
    composite('middle');
    for(const e of world.events)if(!airborne.has(e.type)&&e.type!=='train')paintEvent(e,t);
    if(W>850&&visitSeed>.45){
      const fx=W*.54,fy=trail(fx)+24;
      ellipse(g,fx,fy,11,3,S.mixHex(p.city,'#e8e4d1',.6));ellipse(g,fx,fy-1,8,2,p.sky[1]);
      for(let i=-1;i<=1;i++){g.beginPath();g.moveTo(fx,fy);g.quadraticCurveTo(fx+i*7,fy-20+Math.sin(t*wind)*2,fx+i*7,fy-1);g.strokeStyle=S.mixHex(p.sky[1],'#ffffff',.6);g.lineWidth=1;g.stroke();}
    }
    composite('front');
    for(const e of world.events)if(e.type==='train')paintEvent(e,t);
    composite('trees');
    if(p.night>.15)for(let i=0;i<16;i++){
      const x=rand(i+801)*W+Math.sin(t*.7+i)*10,y=middle(x)+28+rand(i+830)*50+Math.cos(t+i)*6;
      g.globalAlpha=(.2+.6*(.5+.5*Math.sin(t*1.4+i)))*p.night;ellipse(g,x,y,1.5,1.5,'#eff7b7');g.globalAlpha=1;
    }
    for(let i=0;i<12;i++){const x=rand(i+1700)*W,y=Math.min(H+5,near(x)+85+rand(i+1710)*100);line(g,x,y,x+Math.sin(t*.8+i)*3,y-16,S.mixHex(p.front,'#bdd8a5',.4));}
  }
  function paintVessel(e,t){
    if(sky.sun.altitude < -6)return;
    const progress=e.reverse?1-e.age/e.duration:e.age/e.duration;
    const pose=geometry.vessel(e.type,e.lane,-160+progress*(W+320),t,e.reverse);
    if(!pose.visible)return;
    const {x,y,scale,direction}=pose,c=color(e.seed),hull=S.mixHex('#fff3dd',p.sky[1],p.night*.4);
    const length=e.type==='cruise'?72:e.type==='yacht'?39:e.type==='sailboat'?28:16;
    // Wakes are clipped to the lake, while masts may rise above the waterline.
    g.save();path(g,far);g.lineTo(W,geometry.waterTop);g.lineTo(0,geometry.waterTop);g.closePath();g.clip();
    for(let i=0;i<7;i++){
      const phase=(t*(e.type==='jetski'?1.7:.6)+i*.14)%1;
      g.globalAlpha=(1-phase)*.3;const wx=x-direction*(length*.35+i*5)*scale;
      line(g,wx,y+1+phase*3,wx-direction*(8+phase*8)*scale,y+1+phase*3,p.sky[2],1);
    }g.restore();
    g.save();g.translate(x,y);g.scale(direction*scale,scale);
    if(e.type==='jetski'){
      g.fillStyle=c;g.beginPath();g.moveTo(-9,-2);g.lineTo(6,-3);g.lineTo(10,-1);g.lineTo(5,2);g.lineTo(-6,2);g.closePath();g.fill();
      line(g,-2,-3,1,-7,color(e.seed,2),3);ellipse(g,2,-9,1.8,1.8,'#dcb99a');line(g,1,-6,6,-4,'#dcb99a',1.2);line(g,5,-4,7,-4,p.city,1);
    }else{
      g.fillStyle=hull;g.beginPath();g.moveTo(-length/2,-4);g.lineTo(length/2,-4);g.lineTo(length/2-7,3);g.lineTo(-length/2+4,3);g.closePath();g.fill();
      line(g,-length/2+3,1,length/2-4,1,c,2);
      if(e.type==='sailboat'){
        line(g,0,-4,0,-31,p.city,.8);
        g.beginPath();g.moveTo(-1,-29);g.lineTo(-1,-6);g.lineTo(-15,-6);g.closePath();g.fillStyle=hull;g.fill();
        g.beginPath();g.moveTo(2,-26);g.lineTo(2,-6);g.lineTo(13,-6);g.closePath();g.fillStyle=color(e.seed,2);g.fill();
        ellipse(g,5,-5,1.4,1.4,c);
      }else if(e.type==='yacht'){
        g.fillStyle=hull;g.beginPath();g.moveTo(-10,-4);g.lineTo(-5,-12);g.lineTo(7,-12);g.lineTo(14,-4);g.closePath();g.fill();
        g.fillStyle='#83aeb7';g.fillRect(-5,-10,10,3);line(g,-10,-12,9,-12,c,1.5);
        line(g,-2,-12,-2,-20,p.city,.6);
      }else{
        g.fillStyle=hull;g.fillRect(-29,-11,51,7);g.fillRect(-24,-17,40,6);g.fillRect(-18,-21,29,4);
        g.fillStyle=c;g.fillRect(-10,-26,6,5);g.fillRect(0,-25,5,4);
        g.fillStyle='#80a8b4';for(let row=0;row<2;row++)for(let i=0;i<9;i++)g.fillRect(-23+i*4.5,-14+row*6,2.5,2);
        line(g,-27,-5,24,-5,c,1);
      }
    }
    g.restore();
  }
  function paintEvent(e,t){
      if(['jetski','sailboat','cruise','yacht'].includes(e.type))return;
      const f=e.age/e.duration,progress=e.reverse?1-f:f,x=-160+progress*(W+320);
      if(e.type==='metro'){transport(x,rail(x)-4,f,false,e.reverse);return;}
      if(e.type==='train'){transport(x,near(x)+H*.07-2,f,true,e.reverse);return;}
      if(e.type==='cyclist'){
        if(sky.sun.altitude < -6)return;
        const count=e.seed>.55?3+Math.floor(e.seed*4):1;
        geometry.pack(x,count,e.reverse).forEach((pose,i)=>cyclist(pose.x,trail(pose.x),t+i*.8,color(e.seed,i),W<600?.85:1,e.reverse));
        return;
      }
      if(e.type==='bird'){
        if(sky.sun.altitude < -8)return;
        const nest=geometry.nest(),nx=nest.x,ny=nest.y-2;
        // Birds visit the nest with a clean, uninterrupted wing silhouette.
        const travel=S.smooth(0,.8,f),bx=S.lerp(e.reverse?W+20:-20,nx,travel);
        const by=S.lerp(hy*.42+e.lane*30,ny,travel)-Math.sin(travel*Math.PI)*35;
        bird(bx,by,3.5,t,f>.82,true);
        if(e.seed>.4)bird(bx-S.lerp(16,3,travel),by+S.lerp(7,0,travel),3,t+.6,f>.82);
        return;
      }
      if(e.type==='plane'){
        const y=hy*.18+e.lane*hy*.18;
        g.save();g.translate(x,y);g.scale(e.reverse?-1:1,1);
        g.globalAlpha=.45;const tail=g.createLinearGradient(-90,0,-6,0);tail.addColorStop(0,'rgba(248,246,225,0)');tail.addColorStop(1,'rgba(248,246,225,.65)');g.fillStyle=tail;g.fillRect(-90,1,83,.7);g.globalAlpha=1;
        g.fillStyle=S.mixHex('#f6f1db',p.sky[1],p.night*.7);g.beginPath();g.moveTo(9,0);g.lineTo(0,-2);g.lineTo(-7,-8);g.lineTo(-10,-8);g.lineTo(-5,-1);g.lineTo(-13,-1);g.lineTo(-17,-4);g.lineTo(-18,-3);g.lineTo(-16,2);g.lineTo(-5,2);g.lineTo(-10,8);g.lineTo(-7,8);g.lineTo(0,2);g.closePath();g.fill();
        if(p.night>.4){ellipse(g,0,-2,1,1,'#ed8976');ellipse(g,0,2,1,1,'#abcdaa');}g.restore();return;
      }
      if(e.type==='balloon'){
        if(sky.sun.altitude < -4)return;
        const drift=geometry.balloonDrift(e.seed,t,wind),y=hy*.48+e.lane*hy*.18+drift.y,r=10+e.lane*7;
        g.save();g.translate(x+drift.x,y);ellipse(g,0,0,r,r*1.2,color(e.seed));ellipse(g,0,0,r*.62,r*1.2,color(e.seed,2));ellipse(g,0,0,r*.25,r*1.2,color(e.seed,4));
        line(g,-r*.4,r*.95,-3,r*1.6,'#867458',.65);line(g,r*.4,r*.95,3,r*1.6,'#867458',.65);g.fillStyle='#897659';g.fillRect(-3,r*1.5,6,4);g.restore();return;
      }
      if(paintGuest(e,x,f,t))return;
      if(e.type==='abduction'){
        const targetX=W*(.18+e.lane*.62),ground=middle(targetX)+25;
        const enter=S.smooth(0,.22,f),leave=S.smooth(.78,1,f);
        const ux=S.lerp(-80,targetX,enter)+leave*(W+150-targetX),uy=hy*.6+Math.sin(t)*2;
        if(f>.23&&f<.78){
          const beam=g.createLinearGradient(ux,uy,ux,ground);beam.addColorStop(0,'rgba(198,242,188,.3)');beam.addColorStop(1,'rgba(198,242,188,0)');g.fillStyle=beam;g.beginPath();g.moveTo(ux-7,uy);g.lineTo(ux-28,ground);g.lineTo(ux+28,ground);g.lineTo(ux+7,uy);g.closePath();g.fill();
          const lift=Math.sin(S.clamp((f-.25)/.5)*Math.PI),cowY=S.lerp(ground,uy+14,lift);
          // A tiny cow is safely returned before the visitor leaves.
          ellipse(g,ux,cowY,5,3,'#eee8cd');ellipse(g,ux+5,cowY-1,2.3,2,'#eee8cd');ellipse(g,ux-2,cowY-1,2,1.6,'#46584f');line(g,ux-3,cowY+2,ux-3,cowY+5,'#eee8cd',1);line(g,ux+3,cowY+2,ux+3,cowY+5,'#eee8cd',1);
        }
        ellipse(g,ux,uy-3,8,5,'#96bcb1');ellipse(g,ux,uy,18,4,'#c7d5bd');for(let j=-10;j<=10;j+=5)ellipse(g,ux+j,uy+1,1,1,'#f2e5aa');
      }

  }
  function person(x,y,seed,pose='standing',t=0){
    const shirt=color(seed),skin=['#e9c3a5','#bc8d72','#8e6656'][Math.floor(seed*19)%3];
    ellipse(g,x,y+1,5,1.4,S.mixHex(p.front,p.hill,.5));
    ellipse(g,x,y-12,2,2,skin);line(g,x,y-9,x+1,y-4,shirt,3);
    const step=pose==='walk'?Math.sin(t*4)*3:2;
    line(g,x+1,y-4,x-step,y,'#647779',1.4);line(g,x+1,y-4,x+3+step,y,'#647779',1.4);
    line(g,x,y-8,x+5,y-6,skin,1.3);
    if(pose==='read'){g.fillStyle='#fff0cf';g.fillRect(x+3,y-8,6,4);line(g,x+6,y-8,x+6,y-4,shirt,.5);}
  }
  function seated(x,y,seed,direction,book){
    const skin=['#e9c3a5','#bc8d72','#8e6656'][Math.floor(seed*19)%3];
    g.save();g.translate(x,y);g.scale(direction,1);
    line(g,-1,-5,0,-1,color(seed),3.5);ellipse(g,-1,-8,1.9,2.1,skin);
    line(g,0,-1,3,-2,'#647779',1.8);line(g,3,-2,6,0,'#647779',1.5);
    line(g,6,0,8,0,'#526b6c',1.3);line(g,0,-5,3,-3,skin,1.2);
    if(book){g.fillStyle='#fff0cf';g.beginPath();g.moveTo(2,-4);g.lineTo(5,-3);g.lineTo(8,-4);g.lineTo(7,-1);g.lineTo(5,0);g.lineTo(2,-1);g.closePath();g.fill();line(g,5,-3,5,0,'#cbb594',.5);}
    g.restore();
  }
  function airplane(x,y,dir,seed){
    g.save();g.translate(x,y);g.scale(dir,1);g.fillStyle=color(seed);
    g.beginPath();g.moveTo(12,0);g.lineTo(-12,-2);g.lineTo(-17,-7);g.lineTo(-20,-7);g.lineTo(-17,3);g.lineTo(-4,3);g.lineTo(-9,10);g.lineTo(-4,10);g.lineTo(3,3);g.closePath();g.fill();line(g,0,0,-7,-10,color(seed,2),3);g.restore();
  }
  function paintGuest(e,x,f,t){
    if(sky.sun.altitude < -6 && e.type!=='abduction')return true;
    const dir=e.reverse?-1:1,c=color(e.seed),anchor=W*(.1+e.lane*.8),ground=trail(anchor)+19;
    if(['reader','picnic','couple','kite'].includes(e.type)){
      const fade=S.smooth(0,.08,f)*(1-S.smooth(.9,1,f));g.save();g.globalAlpha=fade;
      if(e.type==='picnic'||e.type==='couple'){
        const groundAt=x=>trail(x)+19;
        g.beginPath();g.moveTo(anchor-18,groundAt(anchor-18)-2);g.lineTo(anchor+18,groundAt(anchor+18)-2);g.lineTo(anchor+20,groundAt(anchor+20)+6);g.lineTo(anchor-20,groundAt(anchor-20)+6);g.closePath();g.fillStyle=color(e.seed,2);g.fill();
        seated(anchor-11,groundAt(anchor-11)+1,e.seed,1,false);
        seated(anchor+11,groundAt(anchor+11)+1,(e.seed+.3)%1,-1,e.type==='couple');
        if(e.type==='picnic'){
          ellipse(g,anchor,ground+2,3.2,1.5,'#fff4d8');ellipse(g,anchor,ground+1.5,1.8,.9,'#dc9e7d');
          g.fillStyle='#c8a87c';g.fillRect(anchor+4,ground-1,4,4);g.beginPath();g.arc(anchor+6,ground-1,1.6,Math.PI,0);g.strokeStyle='#a28561';g.lineWidth=.7;g.stroke();
        }
      }else if(e.type==='reader')seated(anchor,ground,e.seed,1,true);
      else person(anchor,ground,e.seed);
      if(e.type==='kite'){
        const kx=anchor+28+Math.sin(t*.3)*12,ky=ground-75+Math.sin(t*.5)*6;
        g.beginPath();g.moveTo(anchor+5,ground-6);g.quadraticCurveTo(anchor+35,ground-25,kx,ky);g.strokeStyle='#8c9585';g.lineWidth=.65;g.stroke();
        g.beginPath();g.moveTo(kx,ky-12);g.lineTo(kx+8,ky);g.lineTo(kx,ky+10);g.lineTo(kx-8,ky);g.closePath();g.fillStyle=c;g.fill();line(g,kx,ky-12,kx,ky+10,color(e.seed,2));
        for(let i=0;i<4;i++)line(g,kx+Math.sin(t+i)*3,ky+10+i*4,kx+Math.sin(t+i+1)*3,ky+14+i*4,c,.7);
      }g.restore();return true;
    }
    if(e.type==='walker'){person(x,trail(x)+5,e.seed,'walk',t);return true;}
    if(e.type==='duck'){
      const pose=geometry.vessel('duck',e.lane,x,t,e.reverse),scale=Math.min(.5,pose.scale*.65),y=pose.y;
      for(let i=0;i<(e.seed>.4?3:1);i++){
        const dx=x-i*8*dir,dy=y+Math.sin(t+i)*.3;
        g.save();g.translate(dx,dy);g.scale(dir*scale,scale);
        line(g,-7,3,7,3,S.mixHex(p.sky[2],p.sky[0],.3),.7);
        ellipse(g,0,0,4,2.2,S.mixHex('#d6c6a2',c,.25));ellipse(g,3,-3,1.8,1.8,S.mixHex('#668d78',c,.25));line(g,4,-3,6,-3,'#dcb779',1);
        g.restore();
      }return true;
    }
    if(e.type==='fish'){
      const fx=anchor+f*25,fy=geometry.waterTop+H*.035;
      ellipse(g,fx,fy-Math.sin(f*Math.PI)*14,3,1.5,c);
      g.globalAlpha=1-f;g.strokeStyle=p.sky[2];g.beginPath();g.ellipse(fx,fy+2,4+f*14,1+f*2,0,0,TAU);g.stroke();g.globalAlpha=1;return true;
    }
    if(e.type==='butterfly'){
      const yy=middle(x)+14+Math.sin(t*2)*8,fold=geometry.wingFold(t,e.seed);
      for(const spread of [fold.left,fold.right]){
        g.save();g.translate(x,yy);g.scale(spread,1);
        g.beginPath();g.moveTo(0,0);g.bezierCurveTo(2,-4,6,-4,5,-1);g.bezierCurveTo(6,2,3,4,0,1);g.closePath();g.fillStyle=color(e.seed,spread<0?0:1);g.fill();g.restore();
      }
      line(g,x,yy-1.5,x,yy+2,'#667a65',.7);return true;
    }
    if(e.type==='rabbit'||e.type==='deer'){
      const deer=e.type==='deer',yy=trail(x)+15,hop=deer?0:Math.abs(Math.sin(t*3))*3;
      ellipse(g,x,yy+1,deer?8:5,1.5,S.mixHex(p.front,p.hill,.4));
      g.save();g.translate(x,yy-hop);g.scale(dir,1);
      ellipse(g,0,deer?-10:-3,deer?7:4,deer?4:3,c);ellipse(g,deer?7:4,deer?-16:-6,deer?3:2,deer?3:2,c);
      for(const xx of deer?[-4,4]:[-2,2])line(g,xx,deer?-8:-2,xx+Math.sin(t*3+xx),0,c,1.2);
      line(g,deer?6:3,deer?-18:-7,deer?5:2,deer?-23:-12,c,1.5);
      if(deer)line(g,5,-11,7,-17,c,3);else line(g,5,-7,6,-12,c,1.4);
      g.restore();return true;
    }
    if(e.type==='hangglider'){
      const y=hy*.4+e.lane*hy*.2+Math.sin(t*.2)*9;
      g.save();g.translate(x,y);g.rotate(Math.sin(t*.3)*.06);
      g.beginPath();g.moveTo(0,-10);g.lineTo(-27,7);g.lineTo(0,2);g.lineTo(27,7);g.closePath();g.fillStyle=c;g.fill();
      g.beginPath();g.moveTo(0,-10);g.lineTo(0,2);g.lineTo(27,7);g.closePath();g.fillStyle=color(e.seed,2);g.fill();
      line(g,-10,3,0,15,'#687d7e',.7);line(g,10,3,0,15,'#687d7e',.7);line(g,0,2,0,11,'#687d7e',.8);
      ellipse(g,1,12,2,2,'#d9b597');line(g,-1,14,-8,17,color(e.seed,4),3);g.restore();return true;
    }
    if(e.type==='airshow'){
      const y=hy*.25+Math.sin(f*Math.PI)*20;
      for(let i=0;i<3;i++){
        const xx=x-i*23*dir,yy=y+(i-1)*17,smoke=['#ec7181','#fffaf2','#639ed9'][i];
        g.save();g.globalAlpha=.85*S.smooth(0,.1,f)*(1-S.smooth(.65,1,f));
        const tail=g.createLinearGradient(xx-dir*160,0,xx,0);tail.addColorStop(0,smoke+'00');tail.addColorStop(1,smoke);
        g.strokeStyle=tail;g.lineWidth=4;g.beginPath();g.moveTo(xx,yy);for(let k=1;k<25;k++)g.lineTo(xx-k*7*dir,yy+Math.sin(t*.5-k*.13)*k*.2);g.stroke();g.restore();airplane(xx,yy,dir,e.seed+i*.1);
      }return true;
    }
    if(e.type==='banner'){
      const y=hy*.3+e.lane*hy*.18,bx=x-dir*86;
      airplane(x,y,dir,e.seed);line(g,x-dir*18,y,bx+dir*39,y+3,'#99a69b',.7);
      g.save();g.translate(bx,y+3);g.rotate(Math.sin(t)*.025);g.fillStyle=S.mixHex('#fff2d8',c,.2);g.fillRect(-39,-6,78,12);
      g.fillStyle='#4d6c72';g.font='7px sans-serif';g.textAlign='center';g.fillText(['ONE THING AT A TIME','ROOM TO BREATHE','HELLO, BEAUTIFUL DAY','TAKE YOUR TIME'][Math.floor(e.seed*4)],0,2.5);g.restore();return true;
    }
    return false;
  }
  const themeQuery=window.matchMedia('(prefers-color-scheme: dark)');
  function updateChrome(){
    if(!p)return;
    const choice=document.documentElement.getAttribute('data-theme');
    const dark=choice==='dark'||(choice!=='light'&&themeQuery.matches);
    document.querySelector('meta[name="theme-color"]').content=S.mixHex(dark?'#344b5f':'#ffffff',p.tint,.03);
  }
  new MutationObserver(updateChrome).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  themeQuery.addEventListener('change',updateChrome);
  function refreshSky(){
    const location=globalThis.LivingLocation?.current();
    sky=S.skyAt(new Date(),location);p=S.palette(sky.sun.altitude);
    if(globalThis.LandscapeMood)p=LandscapeMood.palette(p,sky.date,location);updateChrome();
    document.documentElement.style.setProperty('--scene-tint',p.tint);
    document.documentElement.dataset.scenePeriod=sky.period;
    status.textContent=globalThis.LandscapeMood?.message(sky.date,{...location,sunAltitude:sky.sun.altitude},Math.random)||'A little room to breathe';
    const timeLabel=document.getElementById('sceneTime');
    timeLabel.textContent=globalThis.LivingLocation?.caption(sky.date)||'';
    timeLabel.hidden=!location?.enabled;
    const zone=location?.timezone||'America/New_York';
    const day=new Intl.DateTimeFormat('en-US',{timeZone:zone}).format(sky.date);
    if(day!==sunDay){sunDay=day;sunTimes=S.sunTimes(sky.date,location);}
    const format=d=>d?new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:zone}).format(d):'not today';
    timeLabel.title='Sunrise '+format(sunTimes.rise)+' · Sunset '+format(sunTimes.set);
    timeLabel.setAttribute('aria-label',timeLabel.textContent+'. '+timeLabel.title);
    paintBackground();paintLife(world.elapsed);
  }
  function resize(){
    W=host.clientWidth;H=host.clientHeight;geometry=LandscapeGeometry.create(W,H);hy=geometry.horizon;
    // Pixel budget prevents high-DPR phones from allocating desktop-size canvases.
    dpr=Math.min(window.devicePixelRatio||1,1.5,Math.sqrt(3000000/(W*H)));
    for(const canvas of [back,front]){canvas.width=Math.floor(W*dpr);canvas.height=Math.floor(H*dpr);canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);}
    refreshSky();
  }
  function tick(now){
    if(reduced||document.hidden){frame=0;return;}
    frame=requestAnimationFrame(tick);
    if(now-lastPaint<1000/24)return;
    const dt=last?Math.min((now-last)/1000,.12):0;
    last=now;lastPaint=now;S.advance(world,dt,sky);paintLife(world.elapsed);
  }
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;last=0;clearTimeout(skyTimer);clearTimeout(resizeTimer);skyTimer=0;resizeTimer=0;}
  function scheduleSky(){clearTimeout(skyTimer);if(!document.hidden)skyTimer=setTimeout(()=>{refreshSky();scheduleSky();},60000);}
  function start(){
    stop();if(document.hidden)return;
    if(W!==window.innerWidth||H!==window.innerHeight)resize();else refreshSky();
    scheduleSky();if(!reduced)frame=requestAnimationFrame(tick);
  }
  function updateMotion(){
    reduced=S.motionReduced(preference,mq.matches);
    document.documentElement.dataset.landscapeMotion=reduced?'reduced':'normal';
    motionButton.textContent=reduced?'Motion: reduced':'Motion: normal';
    document.getElementById('deviceMotionNote').hidden=!mq.matches;
    for(const button of dialog.querySelectorAll('[data-landscape-motion]'))button.setAttribute('aria-pressed',String(button.dataset.landscapeMotion===preference));
    start();
  }
  function openMotion(){
    if(dialog.open)return;
    returnFocus=document.activeElement;
    if(!returnFocus || returnFocus===document.body) returnFocus=document.querySelector('#modalRoot button')||motionButton;
    dialog.showModal();
    dialog.querySelector('[data-landscape-motion="reduced"]').focus();
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-landscape-motion], [data-act="scene-settings"], [data-scene-view]');
    if(!button)return;
    if(button.hasAttribute('data-scene-view')){
      const viewing=document.documentElement.classList.toggle('viewing-scene');
      const wrap=document.querySelector('.wrap');wrap.inert=viewing;
      const exit=document.getElementById('exitScene');exit.hidden=!viewing;
      if(viewing)exit.focus();else document.getElementById('viewScene').focus();return;
    }
    if(button.dataset.act==='scene-settings'){openMotion();return;}
    preference=button.dataset.landscapeMotion;
    S.saveMotion(storage,preference);updateMotion();dialog.close();
  });
  dialog.addEventListener('close',()=>{
    // Scanner boot can finish asynchronously after this dialog opens. A newly
    // mounted Quick Start must receive focus instead of the obscured footer.
    const underlying=document.querySelector('#modalRoot button');
    if(underlying && !returnFocus?.closest('#modalRoot'))underlying.focus();
    else if(returnFocus?.isConnected)returnFocus.focus();else motionButton.focus();
  });
  dialog.addEventListener('cancel',()=>{
    // Escape is a safe reduced-motion choice, never an implicit animation opt-in.
    if(preference===null){preference='reduced';S.saveMotion(storage,preference);updateMotion();}
  });
  mq.addEventListener('change',updateMotion);
  window.addEventListener('storage',event=>{if(event.key==='fvp:chain-scanner:landscape-motion'||event.key===null){preference=S.readMotion(storage);updateMotion();}});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);if(!document.hidden)resizeTimer=setTimeout(resize,120);});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stop();else{
      // Resume with a fresh set of commonplace arrivals; the rare-event cooldown
      // survives tab switches, so switching tabs cannot farm an alien encounter.
      const fresh=S.createWorld();world.events=fresh.events;world.next=world.elapsed+fresh.next;start();
    }
  });
  document.addEventListener('landscape-location-change',()=>{sunDay=null;refreshSky();});
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',start);
  resize();updateMotion();if(preference===null)openMotion();
})();
