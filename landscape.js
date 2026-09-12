/* Two canvases: the painted landscape is cached, only its sparse inhabitants
   redraw at 24fps. Device motion preference never enters the synced task state. */
(function(){
  'use strict';
  const S=globalThis.LivingSky,host=document.getElementById('landscape');
  if(!host||!S)return;
  const back=host.querySelector('[data-scenery]'),front=host.querySelector('[data-life]');
  const b=back.getContext('2d',{alpha:false}),g=front.getContext('2d');
  if(!b||!g){host.hidden=true;return;}
  const mq=window.matchMedia('(prefers-reduced-motion: reduce)');
  let storage;try{storage=window.localStorage;}catch{storage=null;}
  let preference=S.readMotion(storage),reduced=S.motionReduced(preference,mq.matches);
  let W=0,H=0,hy=0,dpr=1,frame=0,last=0,lastPaint=0,sky,p,world=S.createWorld();
  let skyTimer=0,resizeTimer=0,returnFocus=null,sunDay=null,sunTimes=null;
  const dialog=document.getElementById('motionDialog');
  const status=document.getElementById('sceneStatus');
  const motionButton=document.getElementById('motionButton');
  const TAU=Math.PI*2;
  const rand=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
  const far=x=>hy+H*.065+Math.sin(x/W*7+.8)*H*.025;
  const middle=x=>hy+H*.19+Math.sin(x/W*6.5-1)*H*.065;
  const near=x=>hy+H*.46+Math.sin(x/W*6+1)*H*.10;
  const rail=x=>hy+H*.115+Math.sin(x/W*3)*H*.01;
  const trail=x=>middle(x)+H*.042;
  const point=(az,alt)=>({x:az/360*W,y:hy-(Math.max(alt,-2)/90)*(hy-22)});
  function path(ctx,fn,start=0,end=W,step=12){ctx.beginPath();ctx.moveTo(start,fn(start));for(let x=start+step;x<end;x+=step)ctx.lineTo(x,fn(x));ctx.lineTo(end,fn(end));}
  function hill(ctx,fn,color){path(ctx,fn);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
  function ellipse(ctx,x,y,rx,ry,color){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fillStyle=color;ctx.fill();}
  function line(ctx,x,y,x2,y2,color,width=1){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function tree(ctx,x,y,size,color,variant=0){
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
    ellipse(b,tx,ty+12,5,5,S.mixHex('#f9e4b3',p.city,1-night*.65-.2));
    line(b,tx,ty+12,tx,ty+8,p.city);line(b,tx,ty+12,tx+3,ty+13,p.city);
    hill(b,far,p.far);
    // Viaduct, stations and catenary are below the skyline, behind the cycle hills.
    for(let x=15;x<W;x+=65){line(b,x,rail(x)+3,x,rail(x)+55,S.mixHex(p.city,p.far,.4),5);}
    path(b,rail);b.strokeStyle=S.mixHex(p.city,'#d6d6bb',.45);b.lineWidth=8;b.stroke();
    path(b,x=>rail(x)-4);b.strokeStyle=S.mixHex(p.city,'#334d4a',.3);b.lineWidth=1.2;b.stroke();
    for(let x=35;x<W;x+=140){line(b,x,rail(x)-4,x,rail(x)-25,p.city,.8);line(b,x-8,rail(x)-25,x+12,rail(x)-25,p.city,.8);}
    path(b,x=>rail(x)-24);b.strokeStyle=p.city;b.lineWidth=.5;b.stroke();
    hill(b,middle,p.hill);
    // Long, gentle contour bands give the hills volume without texture downloads.
    for(let i=0;i<3;i++){path(b,x=>middle(x)+15+i*8);b.strokeStyle=`rgba(225,236,184,${.055*(1-night)})`;b.lineWidth=3;b.stroke();}
    path(b,trail);b.strokeStyle=S.mixHex(p.hill,'#d7cbaa',.72);b.lineWidth=11;b.stroke();
    path(b,trail);b.strokeStyle=S.mixHex(p.hill,'#f3e7bf',.66);b.lineWidth=7;b.stroke();
    b.setLineDash([9,18]);path(b,trail);b.strokeStyle='rgba(255,250,219,.45)';b.lineWidth=.7;b.stroke();b.setLineDash([]);
    for(let i=0;i<35;i++){
      const x=rand(i+200)*W,y=middle(x)-3,size=12+rand(i+300)*25;
      tree(b,x,y,size,S.mixHex(p.hill,p.front,.6),rand(i+10));
    }
    // A cottage, garden and nest are landmarks for the small foreground stories.
    const cx=W*.17,cy=middle(cx)+4;
    b.fillStyle=S.mixHex('#e8d9b4',p.front,night*.78);b.fillRect(cx-14,cy-17,27,19);
    b.beginPath();b.moveTo(cx-19,cy-17);b.lineTo(cx-1,cy-30);b.lineTo(cx+18,cy-17);b.fillStyle=S.mixHex('#aa7561',p.front,night*.7);b.fill();
    b.fillStyle=night>.3?'#f6cf81':'#5d827d';b.fillRect(cx-9,cy-11,6,7);b.fillRect(cx+4,cy-11,6,7);
    const nx=W*.83,ny=middle(nx)-2;
    tree(b,nx,ny,54,S.mixHex(p.hill,p.front,.8),.6);
    ellipse(b,nx+9,ny-34,6,2.4,'#847054');
    if(sky.sun.altitude<0){ellipse(b,nx+7,ny-36,2.3,1.6,p.front);ellipse(b,nx+11,ny-36,2.1,1.6,p.front);}
    for(let i=0;i<8;i++){const x=W*.18+i*7;line(b,x,trail(x)+17,x,trail(x)+6,S.mixHex('#d2c8ab',p.front,night*.7),1.2);}
    path(b,x=>trail(x)+10,W*.18,W*.18+49,7);b.strokeStyle=S.mixHex('#d2c8ab',p.front,night*.7);b.lineWidth=1;b.stroke();
    hill(b,near,p.front);
    // A lower rail line is distinct from the elevated metro.
    path(b,x=>near(x)+H*.07);b.strokeStyle=S.mixHex(p.front,'#b6b89c',.25);b.lineWidth=6;b.stroke();
    path(b,x=>near(x)+H*.07);b.strokeStyle=S.mixHex(p.front,'#c2c6aa',.38);b.lineWidth=1;b.stroke();
    for(let i=0;i<25;i++){
      const x=rand(i+601)*W,y=near(x)+10+rand(i+631)*100;
      tree(b,x,y,23+rand(i+711)*47,S.mixHex(p.front,'#183d32',.25),rand(i+910));
    }
    // Tiny wildflower groups and grasses are static; wind is confined to the overlay.
    for(let i=0;i<140;i++){
      const x=rand(i+900)*W,y=near(x)+30+rand(i+950)*(H-near(x));
      line(b,x,y,x-2,y-5,S.mixHex(p.front,'#b7c79b',.17),.7);
      if(rand(i+970)>.63)ellipse(b,x-2,y-5,1.4,1,S.mixHex('#e7c98a',p.front,night*.8));
    }
    const vignette=b.createLinearGradient(0,hy,0,H);vignette.addColorStop(0,'rgba(5,25,27,0)');vignette.addColorStop(1,'rgba(5,25,27,.15)');b.fillStyle=vignette;b.fillRect(0,hy,W,H-hy);
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
    if(twig){line(g,x,y,x+5,y+2,'#a18b5c',.7);line(g,x+3,y+1,x+5,y-1,'#a18b5c',.7);}
  }
  function cyclist(x,y,t,color,scale=1){
    g.save();g.translate(x,y-3);g.scale(scale,scale);
    g.strokeStyle=S.mixHex('#253f3b',p.front,p.night*.35);g.lineWidth=1;
    for(const xx of [-5,6]){g.beginPath();g.arc(xx,0,3.6,0,TAU);g.stroke();line(g,xx,0,xx+Math.cos(t*6)*3,Math.sin(t*6)*3,g.strokeStyle,.5);}
    const k=Math.sin(t*6)*2;
    line(g,-5,0,-1,-5,color,1.3);line(g,-1,-5,2,0,color,1.3);line(g,2,0,-5,0,color,1.3);line(g,2,0,6,-5,color,1.3);line(g,6,-5,6,0,color,1);
    line(g,0,-5,1+k,-2,'#e5c7a4',1.5);line(g,1+k,-2,2,0,'#e5c7a4',1.2);line(g,-1,-6,1,-11,color,2.8);line(g,1,-10,5,-7,'#e5c7a4',1.2);ellipse(g,2,-13,2,2,'#e6c7a2');ellipse(g,2,-14,2.2,1.1,color);
    g.restore();
  }
  function transport(x,y,progress,isTrain,reverse){
    g.save();g.translate(x,y-6);g.scale(reverse?-1:1,1);
    const n=isTrain?5:3,cw=isTrain?24:22;
    for(let i=0;i<n;i++){
      const xx=-i*(cw+2);g.fillStyle=S.mixHex(isTrain?'#d8bd91':'#e3e8d5',p.city,p.night*.47);g.beginPath();g.roundRect(xx,0,cw,8,2);g.fill();
      g.fillStyle=S.mixHex(isTrain?'#b16d53':'#477c77',p.front,p.night*.35);g.fillRect(xx,5,cw,2);
      g.fillStyle=p.night>.4?'#edce89':'#6b9292';for(let j=3;j<cw-3;j+=5)g.fillRect(xx+j,2,3,2);
    }
    if(p.night>.4){const light=g.createLinearGradient(24,0,65,0);light.addColorStop(0,'rgba(255,230,158,.25)');light.addColorStop(1,'rgba(255,230,158,0)');g.fillStyle=light;g.beginPath();g.moveTo(24,3);g.lineTo(65,-3);g.lineTo(65,11);g.closePath();g.fill();}
    g.restore();
  }
  function paintLife(t){
    g.clearRect(0,0,W,H);
    // Persistent drift guarantees life even between scheduled arrivals. In reduced
    // motion these exact same shapes are drawn once, with no animation loop.
    for(let i=0;i<7;i++){
      const size=(W<600?18:27)+rand(i+101)*30;
      const x=((rand(i+71)*W+t*(1.2+rand(i+2)*1.5)+size*3)%(W+size*6))-size*3;
      cloud(x,25+rand(i+82)*(hy*.68),size,.22+rand(i+54)*.18);
    }
    if(sky.sun.altitude < 4){
      for(let i=0;i<22;i++){
        const x=rand(i+801)*W+Math.sin(t*.7+i)*12,y=middle(rand(i+801)*W)+28+rand(i+830)*90+Math.cos(t*.9+i)*8;
        const alpha=(.2+.8*(.5+.5*Math.sin(t*1.4+i*2)))*(.3+p.night*.7);
        g.globalAlpha=alpha;ellipse(g,x,y,1.2,1.2,'#e8f1a8');g.globalAlpha=alpha*.09;ellipse(g,x,y,5,5,'#ddf19f');g.globalAlpha=1;
      }
    }
    for(const e of world.events){
      const f=e.age/e.duration,progress=e.reverse?1-f:f,x=-160+progress*(W+320);
      if(e.type==='metro'){transport(x,rail(x)-4,f,false,e.reverse);continue;}
      if(e.type==='train'){transport(x,near(x)+H*.07-2,f,true,e.reverse);continue;}
      if(e.type==='cyclist'){
        if(sky.sun.altitude < -6)continue;
        cyclist(x,trail(x),t,S.mixHex(e.seed>.5?'#cd8c67':'#f0d498',p.front,p.night*.7),W<600?.85:1.1);
        if(e.seed>.7)cyclist(x-22,trail(x-22),t+.8,'#87b4b4',.85);
        continue;
      }
      if(e.type==='bird'){
        if(sky.sun.altitude < -8)continue;
        const nx=W*.83,ny=middle(nx)-36;
        // Dawn trips carry nesting material; evening arrivals slow onto the nest.
        const nesting=sky.sun.azimuth<180;
        const travel=S.smooth(0,.8,f),bx=S.lerp(e.reverse?W+20:-20,nx,travel);
        const by=S.lerp(hy*.42+e.lane*30,ny,travel)-Math.sin(travel*Math.PI)*35;
        bird(bx,by,3.5,t,f>.82,nesting&&f<.8);
        if(e.seed>.4)bird(bx-16,by+7,3,t+.6,f>.82,false);
        continue;
      }
      if(e.type==='plane'){
        const y=hy*.18+e.lane*hy*.18;
        g.save();g.translate(x,y);g.scale(e.reverse?-1:1,1);
        g.globalAlpha=.45;const tail=g.createLinearGradient(-90,0,-6,0);tail.addColorStop(0,'rgba(248,246,225,0)');tail.addColorStop(1,'rgba(248,246,225,.65)');g.fillStyle=tail;g.fillRect(-90,1,83,.7);g.globalAlpha=1;
        g.fillStyle=S.mixHex('#f6f1db',p.sky[1],p.night*.7);g.beginPath();g.moveTo(9,0);g.lineTo(0,-2);g.lineTo(-7,-8);g.lineTo(-10,-8);g.lineTo(-5,-1);g.lineTo(-13,-1);g.lineTo(-17,-4);g.lineTo(-18,-3);g.lineTo(-16,2);g.lineTo(-5,2);g.lineTo(-10,8);g.lineTo(-7,8);g.lineTo(0,2);g.closePath();g.fill();
        if(p.night>.4){ellipse(g,0,-2,1,1,'#ed8976');ellipse(g,0,2,1,1,'#abcdaa');}g.restore();continue;
      }
      if(e.type==='balloon'){
        if(sky.sun.altitude < -4)continue;
        const y=hy*.48+e.lane*hy*.18+Math.sin(t*.2+e.seed)*4,r=10+e.lane*7;
        g.save();g.translate(x,y);ellipse(g,0,0,r,r*1.2,'#d6957c');ellipse(g,0,0,r*.62,r*1.2,'#f2d6a1');ellipse(g,0,0,r*.25,r*1.2,'#c47862');
        line(g,-r*.4,r*.95,-3,r*1.6,'#867458',.65);line(g,r*.4,r*.95,3,r*1.6,'#867458',.65);g.fillStyle='#897659';g.fillRect(-3,r*1.5,6,4);g.restore();continue;
      }
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
    // A few foreground stems sway almost imperceptibly in the breeze.
    for(let i=0;i<12;i++){
      const x=rand(i+1700)*W,y=Math.min(H+5,near(x)+85+rand(i+1710)*100);
      g.strokeStyle=S.mixHex(p.front,'#a5b98c',.3);g.lineWidth=1;g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+2,y-10,x+Math.sin(t*.8+i)*3,y-19);g.stroke();
    }
  }
  const themeQuery=window.matchMedia('(prefers-color-scheme: dark)');
  function updateChrome(){
    if(!p)return;
    const choice=document.documentElement.getAttribute('data-theme');
    const dark=choice==='dark'||(choice!=='light'&&themeQuery.matches);
    document.querySelector('meta[name="theme-color"]').content=S.mixHex(dark?'#1c292e':'#fafaf2',p.tint,.03);
  }
  new MutationObserver(updateChrome).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  themeQuery.addEventListener('change',updateChrome);
  function refreshSky(){
    sky=S.skyAt(new Date());p=S.palette(sky.sun.altitude);updateChrome();
    document.documentElement.style.setProperty('--scene-tint',p.tint);
    document.documentElement.dataset.scenePeriod=sky.period;
    const labels={night:'Under the stars',dawn:'The day is waking',day:'A little room to breathe',dusk:'The evening unfolds'};
    status.textContent=labels[sky.period];
    const time=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}).format(sky.date);
    const timeLabel=document.getElementById('sceneTime');
    timeLabel.textContent='Orlando, FL · '+time;
    const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York'}).format(sky.date);
    if(day!==sunDay){sunDay=day;sunTimes=S.sunTimes(sky.date);}
    const format=d=>new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}).format(d);
    timeLabel.title='Sunrise '+format(sunTimes.rise)+' · Sunset '+format(sunTimes.set)+' (Orlando)';
    timeLabel.setAttribute('aria-label',timeLabel.textContent+'. '+timeLabel.title);
    paintBackground();paintLife(world.elapsed);
  }
  function resize(){
    W=window.innerWidth;H=window.innerHeight;hy=Math.min(H*(W<600?.37:.47),W<600?310:480);
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
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',start);
  resize();updateMotion();if(preference===null)openMotion();
})();
