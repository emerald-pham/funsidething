/* Two visible canvases: the painted landscape is cached, while its sparse
   inhabitants and water redraw on the animation clock. Motion preference stays local. */
(async function(){
  'use strict';
  const S=globalThis.LivingSky,host=document.getElementById('landscape');
  if(!host||!S)return;
  // Apply local rates before creating the opening cast, including zero rates.
  await fetch('./SPAWN_RATES.md').then(response=>{
    if(!response.ok)throw new Error('Spawn rates unavailable');
    return response.text();
  }).then(markdown=>{
    if(!LandscapeConfig.setSpawnRates(markdown))throw new Error('Invalid spawn rates');
  }).catch(error=>console.warn(error.message));
  const back=host.querySelector('[data-scenery]'),front=host.querySelector('[data-life]');
  let b=back.getContext('2d',{alpha:false});const base=b,g=front.getContext('2d');
  const layers={};let geometry;
  const cityLayer=document.createElement('canvas'),partyLayer=document.createElement('canvas'),skyCity=document.createElement('canvas'),skyReflection=document.createElement('canvas'),blurredReflection=document.createElement('canvas'),softenedReflection=document.createElement('canvas'),reflectionCanvas=document.createElement('canvas');
  if(!b||!g){host.hidden=true;return;}
  const mq=window.matchMedia('(prefers-reduced-motion: reduce)');
  let storage;try{storage=window.localStorage;}catch{storage=null;}
  const sceneStorage=S.createSceneMirror(storage);
  LandscapeMood.configureHistory(storage);
  LandscapeMood.setPersonalHourlyQuotes(window.getScannerHourlyQuotes?.()||{});
  window.addEventListener('scanner-hourly-quotes-change',event=>{
    LandscapeMood.setPersonalHourlyQuotes(event.detail||{});refreshSky();
  });
  let currentEntry=null,visibleBanners=[];
  function sceneTextVisible(element){
    const rect=element.getBoundingClientRect();
    if(!rect.width||!rect.height)return false;
    const x=(Math.max(0,rect.left)+Math.min(window.innerWidth,rect.right))/2;
    const y=(Math.max(0,rect.top)+Math.min(window.innerHeight,rect.bottom))/2;
    if(rect.bottom<=0||rect.top>=window.innerHeight||rect.right<=0||rect.left>=window.innerWidth)return false;
    const hit=document.elementFromPoint(x,y);
    return hit===element||element.contains(hit);
  }
  function scenePointVisible(x,y){
    if(x<0||x>window.innerWidth||y<0||y>window.innerHeight)return false;
    const hit=document.elementFromPoint(x,y);
    return hit===document.body||hit===document.documentElement||!!hit?.closest('#landscape');
  }
  function observeSceneInteraction(event){
    // Passive time, synthetic events, hidden tabs, and covered text are not
    // evidence of reading. Capture before a click changes the displayed UI.
    if(!event.isTrusted||document.hidden||!document.hasFocus())return;
    if(currentEntry&&!currentEntry.seen&&sceneTextVisible(status)){
      LandscapeMood.recordSeen(currentEntry.text,currentEntry.seenKey||currentEntry.text);currentEntry.seen=true;
    }
    for(const {event:banner,x,y} of visibleBanners){
      if(!banner.textSeen&&banner.bannerText&&scenePointVisible(x,y)){
        LandscapeMood.recordSeen(banner.bannerText);banner.textSeen=true;
      }
    }
  }
  for(const type of ['pointerdown','keydown','wheel','touchstart'])
    document.addEventListener(type,observeSceneInteraction,{capture:true,passive:true});
  let preference=S.readMotion(storage),reduced=S.motionReduced(preference,mq.matches);
  const T=globalThis.LandscapeTimeline,sceneSeed=T.DEFAULT_SEED;
  const cityLights={next:7.5,windows:[],gardens:S.createGardenLights([],()=>.99)},woodland={events:[]};
  let timeline=null,timelineKey='',sceneSnapshot=null,lastCitySlot=null;
  let rooftopRoofs=[],rooftopParty=null,clocktowerVisit=null,partyTimer=0;
  let sceneSeason=S.readSceneSeason(sceneStorage)||LandscapeMood.season(new Date(),globalThis.LivingLocation?.current()).name,treeOrigins=[];
  let W=0,H=0,hy=0,dpr=1,frame=0,last=0,nextPaint=0,sky,p,world={elapsed:0,events:[]};
  let skyTimer=0,resizeTimer=0,returnFocus=null;
  const dialog=document.getElementById('motionDialog');
  const status=document.getElementById('sceneStatus');
  const motionButton=document.getElementById('motionButton');
  const TAU=Math.PI*2,visitSeed=T.sample(sceneSeed,'visitors'),wind=.6+T.sample(sceneSeed,'wind')*1.2;
  const rand=n=>T.terrainSample(n,sceneSeed);
  const far=x=>geometry.far(x),middle=x=>geometry.middle(x),near=x=>geometry.near(x);
  const rail=x=>geometry.rail(x),trail=x=>geometry.trail(x);
  const colors=['#db947e','#a4c9bd','#e6c680','#ada9ce','#88b9cf','#e8b6c4'];
  const color=(seed,offset=0)=>S.mixHex(colors[Math.floor((seed*97+offset)%colors.length)],p.front,p.night*.35);
  const skinColor=seed=>S.skinTone(seed,p.night,p.city);
  function personHead(ctx,x,y,rx,ry,seed,skin,hat=false){
    const appearance=LandscapeAppearance.person(seed),hair=S.mixHex(appearance.color,p.city,p.night*.4),style=appearance.style;
    // Hair belongs to an individual; protective headwear always takes precedence.
    if(!hat&&style!=='bald'){
      if(style==='long'||style==='bob')ellipse(ctx,x-rx*.3,y+ry*.35,rx*1.15,ry*(style==='long'?1.65:1.1),hair);
      if(style==='bun')ellipse(ctx,x-rx*.8,y-ry*.8,rx*.65,ry*.65,hair);
      if(style==='ponytail')ellipse(ctx,x-rx*1.1,y+ry*.6,rx*.55,ry*1.15,hair);
    }
    ellipse(ctx,x,y,rx,ry,skin);
    if(!hat&&style!=='bald'){
      ellipse(ctx,x-rx*.1,y-ry*.67,rx*1.07,ry*.55,hair);
      if(style==='curly')for(let i=0;i<4;i++)ellipse(ctx,x-rx+i*rx*.6,y-ry*.7-Math.sin(i)*ry*.4,rx*.48,ry*.48,hair);
    }
  }
  function layer(name,top){
    const canvas=layers[name]||(layers[name]=document.createElement('canvas'));
    canvas.width=Math.floor(W*dpr);canvas.height=Math.max(1,Math.ceil((H-top)*dpr));canvas.top=top;
    b=canvas.getContext('2d');b.setTransform(dpr,0,0,dpr,0,-top*dpr);
  }
  function composite(name){const c=layers[name];if(c)g.drawImage(c,0,c.top,c.width/dpr,c.height/dpr);}
  function createWaterDistortion(){
    const canvas=document.createElement('canvas');
    let gl=null,ready=false,unavailable=false,program,texture,position,time,size;
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;});
    canvas.addEventListener('webglcontextrestored',()=>{ready=false;});
    function initialize(){
      gl=gl||canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false});
      if(!gl)return false;
      const shader=(type,source)=>{
        const result=gl.createShader(type);gl.shaderSource(result,source);gl.compileShader(result);
        if(!gl.getShaderParameter(result,gl.COMPILE_STATUS)){gl.deleteShader(result);return null;}
        return result;
      };
      const vertex=shader(gl.VERTEX_SHADER,`attribute vec2 position;
        varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`);
      const fragment=shader(gl.FRAGMENT_SHADER,`precision highp float;
        varying vec2 uv;uniform sampler2D image;uniform float time;uniform vec2 size;
        void main(){
          // Texture upload is flipped: depth is distance upward from its bottom
          // edge, which becomes distance below the horizon after the final flip.
          float x=uv.x*size.x,depth=uv.y*size.y;
          float q=clamp(depth/28.,0.,1.);
          float envelope=q*q*(3.-2.*q)*(.25+.75*clamp(depth/110.,0.,1.));
          // Crossing fine packets make reflected height breathe while skyline
          // edges move less than a pixel sideways. The phase warp breaks the
          // obvious back-and-forth rhythm of a single traveling sine wave.
          float warp=.6*sin(x*.034+depth*.051+time*.23);
          float packet=sin(depth*.49+x*.022-time*1.11+warp);
          float detail=sin(depth*.91-x*.047+time*1.39+.35*sin(x*.015+depth*.037-time*.31));
          float field=packet*.68+detail*.32;
          float dx=envelope*(.33*field+.1*sin(x*.071+depth*.24-time*.63));
          float dy=envelope*1.25*field;
          gl_FragColor=texture2D(image,uv+vec2(dx/size.x,dy/size.y));
        }`);
      if(!vertex||!fragment){if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);return false;}
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);return false;}
      gl.useProgram(program);
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.uniform1i(gl.getUniformLocation(program,'image'),0);
      time=gl.getUniformLocation(program,'time');size=gl.getUniformLocation(program,'size');
      ready=true;return true;
    }
    return {render(source,t,wind,frozen,width,height){
      // Reduced motion and unavailable/lost GPU contexts retain a complete,
      // undistorted mirror. No rows, meshes, or extra water strokes are drawn.
      if(frozen||unavailable||gl?.isContextLost())return source;
      if(!ready&&!initialize()){unavailable=true;return source;}
      if(canvas.width!==source.width)canvas.width=source.width;
      if(canvas.height!==source.height)canvas.height=source.height;
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      gl.uniform1f(time,t*Math.max(.35,Number(wind)||1));gl.uniform2f(size,width,height);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      return canvas;
    }};
  }
  const waterDistortion=createWaterDistortion();
  function paintHorizonReflection(source,t,opacity=1){
    const surface=geometry.reflectionSurface(p.night);
    source=waterDistortion.render(source,t,wind,reduced,W,geometry.waterTop);
    // A continuous pixel displacement bends local patches without introducing
    // strip boundaries, lowering resolution, or swaying the lake as one sheet.
    g.save();g.globalAlpha=opacity;
    g.translate(0,2*surface.axisY);
    // Overdraw the clipped waterline by one device pixel so canvas edge
    // sampling cannot leave a pale seam under the skyline.
    g.translate(0,-1/dpr);g.scale(1,-1);
    g.drawImage(source,0,0,W,geometry.waterTop);
    g.restore();
  }
  const point=(az,alt)=>geometry.skyPoint(az,alt);
  function path(ctx,fn,start=0,end=W,step=12){ctx.beginPath();ctx.moveTo(start,fn(start));for(let x=start+step;x<end;x+=step)ctx.lineTo(x,fn(x));ctx.lineTo(end,fn(end));}
  function hill(ctx,fn,color){path(ctx,fn);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
  function ellipse(ctx,x,y,rx,ry,color){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fillStyle=color;ctx.fill();}
  function line(ctx,x,y,x2,y2,color,width=1){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function paintRooftopPatio(ctx,patio){
    const {x,y,bw}=patio,deckWidth=Math.max(4,bw*.84),deckX=x+(bw-deckWidth)/2,deckY=y-1.8;
    const postHeight=Math.min(3,Math.max(1.5,bw*.16)),left=deckX+deckWidth*.16,right=deckX+deckWidth*.84,sag=1.15;
    const wireY=deckY-postHeight,lightAlpha=p.night*.8;
    ctx.save();ctx.globalAlpha=.8;
    ctx.fillStyle=S.mixHex(p.hill,p.front,.42);ctx.fillRect(deckX,deckY,deckWidth,1.8);
    line(ctx,deckX,deckY,deckX+deckWidth,deckY,S.mixHex(p.front,p.sky[2],.36),.55);
    // The poles belong to the selected string: leaving dormant hardware above
    // the deck drew bare poles in daylight and after a nighttime sample ended.
    if(sky.sun.altitude>=0||!cityLights.gardens.lit[patio.index]){ctx.restore();return;}
    line(ctx,left,deckY,left,wireY,S.mixHex(p.front,p.sky[2],.28),.55);
    line(ctx,right,deckY,right,wireY,S.mixHex(p.front,p.sky[2],.28),.55);
    ctx.beginPath();ctx.moveTo(left,wireY);ctx.quadraticCurveTo((left+right)/2,wireY+sag,right,wireY);
    ctx.strokeStyle=`rgba(255,222,160,${lightAlpha})`;ctx.lineWidth=.7;ctx.stroke();
    for(let bulb=0;bulb<5;bulb++){
      const fraction=bulb/4,bx=left+(right-left)*fraction,wireBulbY=wireY+2*sag*fraction*(1-fraction),bulbY=wireBulbY+.55;
      line(ctx,bx,wireBulbY,bx,bulbY,`rgba(255,220,143,${lightAlpha})`,.45);
      ellipse(ctx,bx,bulbY,.58,.58,`rgba(255,220,143,${lightAlpha})`);
    }
    ctx.restore();
  }
  function paintRooftopParty(){
    if(p.night<=.12||!rooftopParty.active)return;
    const roof=rooftopRoofs.find(candidate=>candidate.index===rooftopParty.active.roofIndex);
    if(!roof)return;
    const partyCtx=partyLayer.getContext('2d');
    partyCtx.clearRect(0,0,W,H);
    for(let fixture=0;fixture<2;fixture++){
      const pose=geometry.partyBeamPose(roof,rooftopParty.active.age,fixture,reduced),color=pose.color;
      const [red,green,blue]=color.match(/^#(..)(..)(..)$/).slice(1).map(channel=>parseInt(channel,16));
      const beam=partyCtx.createLinearGradient(pose.originX,pose.originY,pose.tipX,pose.tipY);
      beam.addColorStop(0,`rgba(${red},${green},${blue},0)`);
      beam.addColorStop(.32,`rgba(${red},${green},${blue},.055)`);
      beam.addColorStop(.72,`rgba(${red},${green},${blue},.22)`);
      beam.addColorStop(1,`rgba(${red},${green},${blue},.42)`);
      const normalX=-(pose.tipY-pose.originY)/pose.length,normalY=(pose.tipX-pose.originX)/pose.length;
      const spread=pose.spread;
      partyCtx.save();partyCtx.globalAlpha=p.night*(reduced?.78:.72);
      partyCtx.fillStyle=S.mixHex(p.front,color,.42);partyCtx.fillRect(pose.originX-.45,pose.originY+.2,.9,.65);
      partyCtx.beginPath();partyCtx.moveTo(pose.originX,pose.originY);
      partyCtx.lineTo(pose.tipX+normalX*spread,pose.tipY+normalY*spread);
      partyCtx.lineTo(pose.tipX-normalX*spread,pose.tipY-normalY*spread);
      partyCtx.closePath();partyCtx.fillStyle=beam;partyCtx.fill();
      partyCtx.globalAlpha=p.night*.9;ellipse(partyCtx,pose.originX,pose.originY,1.1,1.1,color);
      partyCtx.globalAlpha=p.night*.82;ellipse(partyCtx,pose.originX,pose.originY,.45,.45,'#fff8d7');partyCtx.restore();
    }
    // Use the already-composited skyline's alpha as one union mask. This hides
    // beams behind overlapping towers and the clock tower without even-odd
    // path holes or cutting into any other dynamic foreground layer.
    partyCtx.save();partyCtx.globalCompositeOperation='destination-out';
    partyCtx.drawImage(cityLayer,0,0,cityLayer.width/dpr,cityLayer.height/dpr);partyCtx.restore();
    g.drawImage(partyLayer,0,0,W,H);
  }
  function paintGroundShadow(ctx,x,y,height,width,ground=p.front,strength=1){
    const shade=geometry.castShadow(sky,height,width,x,y);
    ctx.save();ctx.globalAlpha*=shade.alpha*strength;
    ctx.beginPath();ctx.ellipse(x+shade.dx*.5,y+shade.dy*.5,shade.rx,shade.ry,
      Math.atan2(shade.dy,shade.dx),0,TAU);
    ctx.fillStyle=S.mixHex(ground,'#203d37',.68);ctx.fill();ctx.restore();
  }
  function paintRailVehicleShadow(ctx,x,y,height,width,angle,ground){
    const shade=geometry.castShadow(sky,height,width,x,y);
    ctx.save();ctx.globalAlpha*=shade.alpha;
    ctx.beginPath();
    // Car bodies span the rail, so their contact shade follows the rail too.
    // The upright-object oval turns the whole car width toward the light ray.
    ctx.ellipse(x+shade.dx*.45,y+shade.dy*.35,width*.54+Math.abs(shade.dx)*.12,
      Math.max(1.1,height*.13),angle,0,TAU);
    ctx.fillStyle=S.mixHex(ground,'#203d37',.68);ctx.fill();ctx.restore();
  }
  function paintRailShadow(ctx,track,height,width,ground,strength){
    ctx.save();ctx.strokeStyle=S.mixHex(ground,'#203d37',.68);
    ctx.lineWidth=width;ctx.lineCap='round';
    // Each short span faces the same sky disc from its own place on the hill.
    // A single canvas shadow offset incorrectly points every span one way.
    for(let x=-8;x<W+8;x+=18){
      const end=Math.min(W+8,x+18),startY=track(x),endY=track(end);
      const a=geometry.castShadow(sky,height,width,x,startY);
      const z=geometry.castShadow(sky,height,width,end,endY);
      ctx.globalAlpha=a.alpha*strength;
      ctx.beginPath();ctx.moveTo(x+a.dx*.4,startY+a.dy*.4+1);
      ctx.lineTo(end+z.dx*.4,endY+z.dy*.4+1);ctx.stroke();
    }
    ctx.restore();
  }
  function paintGrass(kind,ground){
    if(sceneSeason==='winter')return;
    for(const blade of geometry.grassBand(kind)){
      const ink=S.mixHex(ground,blade.seed>.78?'#dfc995':'#b7c79b',.15+(1-p.night)*.11);
      line(b,blade.x,blade.y,blade.x-blade.height*.3,blade.y-blade.height,ink,
        kind==='near'?.7:kind==='middle'?.55:.45);
      if(kind==='near'&&blade.seed>.89)ellipse(b,blade.x-blade.height*.3,blade.y-blade.height,
        1.2,.9,S.mixHex('#e7c98a',ground,p.night*.8));
    }
  }
  function tree(ctx,x,y,size,color,variant=0){
    treeOrigins.push({x,y,size,variant});
    if(sceneSeason==='autumn')color=S.mixHex(['#a76c43','#bb864d','#c59b59','#956343'][Math.floor(rand(x+y)*4)],p.front,p.night*.5);
    if(sceneSeason==='spring')color=S.mixHex(color,'#bbcf95',.16);
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
    const phase=Math.acos(1-2*sky.illumination),sign=sky.phase<=180?1:-1;
    ctx.translate(q.x,q.y);ctx.rotate(sky.moon.brightLimbAngle-(sign<0?Math.PI:0));ctx.translate(-q.x,-q.y);
    ctx.beginPath();
    for(let i=0;i<=40;i++){const y=-r+i*r/20,x=sign*Math.sqrt(Math.max(0,r*r-y*y));if(i===0)ctx.moveTo(q.x+x,q.y+y);else ctx.lineTo(q.x+x,q.y+y);}
    for(let i=40;i>=0;i--){const y=-r+i*r/20,x=sign*Math.cos(phase)*Math.sqrt(Math.max(0,r*r-y*y));ctx.lineTo(q.x+x,q.y+y);}
    ctx.closePath();ctx.fillStyle='#f4efd1';ctx.fill();ctx.clip();
    ellipse(ctx,q.x-3,q.y+4,3,2,'rgba(119,133,132,.16)');ellipse(ctx,q.x+5,q.y-4,2,3,'rgba(119,133,132,.15)');
    ctx.restore();
  }
  function paintBackground(){
    treeOrigins=[];
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
    // Cache the painted buildings and windows on transparency before adding
    // them to the background and the shared sky-and-city mirror.
    const cityTarget=b;
    cityLayer.width=Math.floor(W*dpr);cityLayer.height=Math.ceil(geometry.waterTop*dpr);
    b=cityLayer.getContext('2d');b.setTransform(dpr,0,0,dpr,0,0);
    const plan=geometry.cityscape(rand),buildings=plan.towers,count=buildings.length;let windowIndex=0;
    rooftopRoofs=plan.partyRoofs;
    if(rooftopParty.active&&!rooftopRoofs.some(roof=>roof.index===rooftopParty.active.roofIndex))rooftopParty.active=null;
    S.syncGardenLights(cityLights.gardens,[...plan.gardens,...plan.patios].map(roof=>roof.index),()=>.99);
    const sharedRoofs=Object.keys(sceneSnapshot.gardens).map(Number);
    for(const roof of [...plan.gardens,...plan.patios]){
      const position=roof.index/count,nearest=sharedRoofs.reduce((best,index)=>Math.abs(index/96-position)<Math.abs(best/96-position)?index:best,sharedRoofs[0]);
      cityLights.gardens.lit[roof.index]=sceneSnapshot.gardens[nearest]??false;
    }
    const gardenLights=cityLights.gardens,gardens=new Map(plan.gardens.map(garden=>[garden.index,garden]));
    const patios=new Map(plan.patios.map(patio=>[patio.index,patio]));
    cityLights.visible=[];
    for(let i=0;i<count;i++){
      const {x,y,bw,bh}=buildings[i],facade=LandscapeAppearance.building(rand(i+113),bh/(W<600?66.4:83),night,p.city);
      b.fillStyle=facade.wall;b.fillRect(x,y,bw,bh+15);
      if(facade.material==='brick'){
        for(let yy=y+4;yy<hy+12;yy+=4){
          line(b,x,yy,x+bw,yy,facade.detail,.45);
          for(let xx=x+((Math.round(yy-y)/4)%2?3:0);xx<x+bw;xx+=6)line(b,xx,yy-3,xx,yy,facade.detail,.45);
        }
      }else for(let xx=x+2;xx<x+bw;xx+=4)line(b,xx,y,xx,hy+12,facade.detail,.5);
      b.fillStyle=facade.wall;
      if(buildings[i].hasLightningRod){b.fillRect(x+bw*.25,y-5,bw*.5,6);line(b,x+bw*.5,y-5,x+bw*.5,y-12,p.city,.7);}
      for(let yy=y+5;yy<hy+8;yy+=7)for(let xx=x+3;xx<x+bw-2;xx+=5){
        const lightIndex=windowIndex++;
        const normalizedWindow=`${Math.round(i/count*96)}:${Math.round((xx-x-3)/5)}:${Math.round((yy-y-5)/7)}`;
        cityLights.windows[lightIndex]=T.windowLit(sceneSeed,normalizedWindow,sceneSnapshot.windowsSlot);
        const behindTower=xx+1.6>W*.71-12&&xx<W*.71+12&&yy+2.7>hy-91;
        const covered=buildings.slice(i+1).some(other=>xx+1.6>other.x&&xx<other.x+other.bw&&yy+2.7>other.y-12);
        if(xx+1.6<W&&!behindTower&&!covered)cityLights.visible.push(lightIndex);
        b.fillStyle=night>.2 && cityLights.windows[lightIndex]?`rgba(255,220,153,${night*.8})`:'rgba(225,239,232,.22)';b.fillRect(xx,yy,1.6,2.7);
      }
      if(gardens.has(i)){
        const garden=gardens.get(i);
        const deckWidth=Math.max(3,bw*.72),deckX=x+(bw-deckWidth)/2,deckY=y-1.8;
        b.fillStyle=S.mixHex(p.hill,p.front,.42);b.fillRect(deckX,deckY,deckWidth,1.8);
        line(b,deckX,deckY,deckX+deckWidth,deckY,S.mixHex(p.front,p.sky[2],.36),.55);
        for(let pot=0;pot<2;pot++){
          const px=deckX+deckWidth*(.23+pot*.52);
          b.fillStyle=S.mixHex(p.far,p.hill,.38+rand(i+pot+1100)*.2);b.fillRect(px,deckY-1,Math.max(1,deckWidth*.18),1.1);
          ellipse(b,px+deckWidth*.08,deckY-1.2,.8,.65,S.mixHex(p.far,p.front,.28));
        }
        if(sky.sun.altitude<0&&night>.12&&gardenLights.lit[garden.index])for(let light=0;light<garden.lights;light++)
          ellipse(b,deckX+deckWidth*(.44+light*.22),deckY-1.1,.55,.55,`rgba(255,228,157,${night*.92})`);
      }
      if(patios.has(i))paintRooftopPatio(b,patios.get(i));
    }
    // A small clock tower and civic dome give the distant city a recognizable heart.
    const tx=W*.71,ty=hy-72;
    b.fillStyle=p.city;b.fillRect(tx-9,ty,18,geometry.waterTop-ty);b.fillRect(tx-12,ty-4,24,5);
    const clockRoof=geometry.clocktowerRoof();
    b.beginPath();b.moveTo(clockRoof.left.x,clockRoof.left.y);b.lineTo(clockRoof.apex.x,clockRoof.apex.y);b.lineTo(clockRoof.right.x,clockRoof.right.y);b.fill();
    ellipse(b,tx,ty+12,5,5,S.mixHex('#fff0c9',p.city,.18));
    const hands=globalThis.LandscapeMood?.clock(sky.date)||{minuteAngle:0,hourAngle:0};
    line(b,tx,ty+12,tx+Math.sin(hands.minuteAngle)*4,ty+12-Math.cos(hands.minuteAngle)*4,'#577581',.9);
    line(b,tx,ty+12,tx+Math.sin(hands.hourAngle)*2.8,ty+12-Math.cos(hands.hourAngle)*2.8,'#577581',1.2);
    b=cityTarget;b.drawImage(cityLayer,0,0,cityLayer.width/dpr,cityLayer.height/dpr);
    // Cache the opaque sky and skyline before the lake fill touches their
    // bottom row; sampling that water row made a thin bright horizon seam.
    const skyCityHeight=Math.max(1,Math.floor(geometry.waterTop*dpr));
    if(skyCity.width!==back.width)skyCity.width=back.width;
    if(skyCity.height!==skyCityHeight)skyCity.height=skyCityHeight;
    const skyCityContext=skyCity.getContext('2d');
    skyCityContext.setTransform(1,0,0,1,0,0);
    skyCityContext.drawImage(base.canvas,0,0,back.width,skyCityHeight,0,0,skyCity.width,skyCity.height);
    const water=b.createLinearGradient(0,geometry.waterTop,0,hy+H*.18);
    water.addColorStop(0,S.mixHex(p.sky[2],p.sky[0],.35));water.addColorStop(1,S.mixHex(p.sky[1],p.front,.3));
    b.fillStyle=water;b.fillRect(0,geometry.waterTop,W,H);
    for(let i=0;i<90;i++){
      const x=rand(i+44)*W,y=geometry.waterTop+rand(i+79)*H*.12;
      line(b,x,y,x+8+rand(i)*28,y,S.mixHex(p.sky[2],p.city,.18),.6);
    }
    hill(b,far,p.far);
    paintGrass('far',p.far);
    // Viaduct, stations and catenary are below the skyline, behind the cycle hills.
    // Keep the deck, supports, and overhead electrical together at every
    // hour; fading any one leaves the passing metro visibly disconnected.
    for(let x=15;x<W;x+=65){
      paintGroundShadow(b,x,rail(x)+55,55,5,p.far,.55);
      line(b,x,rail(x)+3,x,rail(x)+55,S.mixHex(p.city,p.far,.4),5);
    }
    // The deck itself marks the full-width line; a second continuous ground
    // shadow made the elevated railway read as a broad horizontal band.
    path(b,rail);b.strokeStyle=S.mixHex(p.city,'#d6d6bb',.45);b.lineWidth=8;b.stroke();
    path(b,x=>rail(x)-4);b.strokeStyle=S.mixHex(p.city,'#334d4a',.3);b.lineWidth=1.2;b.stroke();
    // The metro is drawn at 72% scale; its roof is about nine pixels above
    // the rail. Keep the wire and crossarms close to that roof, not at the
    // full-size train height used by the separate foreground line.
    for(let x=35;x<W;x+=140){line(b,x,rail(x)-4,x,rail(x)-14,p.city,.8);line(b,x-6,rail(x)-14,x+8,rail(x)-14,p.city,.8);}
    path(b,x=>rail(x)-13);b.strokeStyle=p.city;b.lineWidth=.5;b.stroke();
    layer("middle",Math.max(0,hy+H*.14-85));
    hill(b,middle,p.hill);
    paintGrass('middle',p.hill);
    // Long, gentle contour bands give the hills volume without texture downloads.
    for(let i=0;i<3;i++){path(b,x=>middle(x)+15+i*8);b.strokeStyle=`rgba(225,236,184,${.055*(1-night)})`;b.lineWidth=3;b.stroke();}
    // Carry every road stroke past the viewport so its end caps cannot show
    // as clipped road ends on narrow screens.
    path(b,trail,-12,W+12);b.strokeStyle=S.mixHex(p.hill,'#d7cbaa',.72);b.lineWidth=11;b.stroke();
    path(b,trail,-12,W+12);b.strokeStyle=S.mixHex(p.hill,'#f3e7bf',.66);b.lineWidth=7;b.stroke();
    b.setLineDash([9,18]);path(b,trail,-12,W+12);b.strokeStyle='rgba(255,250,219,.45)';b.lineWidth=.7;b.stroke();b.setLineDash([]);
    const midTrees=[];
    for(let i=0;i<35;i++){
      const x=rand(i+200)*W,y=middle(x)+2,size=12+rand(i+300)*25;
      if(Math.abs(x-geometry.nest().treeX)>32)midTrees.push({x,y,size,variant:rand(i+10)});
    }
    const nest=geometry.nest();midTrees.push({x:nest.treeX,y:nest.ground,size:54,variant:.6});
    // Shadows belong to the ground, never to a later tree's foreground pass.
    for(const t of midTrees)paintGroundShadow(b,t.x,t.y,t.size,t.size*.44,p.hill);
    for(const t of midTrees.sort((a,b)=>a.y-b.y))tree(b,t.x,t.y,t.size,S.mixHex(p.hill,p.front,.6),t.variant);
    if(W>650){
      // A short secondary walking loop rejoins the main path; it never crosses rails.
      path(b,x=>trail(x)+Math.sin((x-W*.3)/(W*.25)*Math.PI)*22,W*.3,W*.55);
      b.strokeStyle=S.mixHex(p.hill,'#eedcba',.65);b.lineWidth=4;b.stroke();
      if(W>1000&&visitSeed<.75){
        const ax=W*.62,ay=trail(ax)+18;
        line(b,ax-6,ay,ax-6,ay-15,p.city,1.3);line(b,ax-8,ay-15,ax+8,ay-15,p.city,1.3);
        for(const dx of [-4,6]){b.beginPath();b.arc(ax+dx,ay-5,3,0,TAU);b.strokeStyle=p.city;b.lineWidth=1;b.stroke();}
        line(b,ax-4,ay-5,ax+1,ay-11,color(visitSeed),1.5);line(b,ax+1,ay-11,ax+6,ay-5,color(visitSeed),1.5);
      }
    }
    line(b,nest.treeX,nest.y+5,nest.x+1,nest.y+2,'#8e8065',1.4);
    b.beginPath();b.ellipse(nest.x,nest.y,4,2.3,0,0,Math.PI);b.fillStyle='#a28b67';b.fill();
    line(b,nest.x-4,nest.y,nest.x+4,nest.y,'#b6a080',.7);
    if(sky.sun.altitude < -8){ellipse(b,nest.x-1.5,nest.y-1,1.5,1.2,p.front);ellipse(b,nest.x+1.5,nest.y-1,1.5,1.2,p.front);}
    for(let i=0;i<8;i++){const x=W*.18+i*7;line(b,x,trail(x)+17,x,trail(x)+6,S.mixHex('#d2c8ab',p.front,night*.7),1.2);}
    path(b,x=>trail(x)+10,W*.18,W*.18+49,7);b.strokeStyle=S.mixHex('#d2c8ab',p.front,night*.7);b.lineWidth=1;b.stroke();
    layer("front",Math.max(0,hy+H*.35));
    hill(b,near,p.front);
    paintGrass('near',p.front);
    // A lower rail line is distinct from the elevated metro.
    paintRailShadow(b,x=>near(x)+H*.07,8,6,p.front,.5);
    path(b,x=>near(x)+H*.07);b.strokeStyle=S.mixHex(p.front,'#b6b89c',.25);b.lineWidth=6;b.stroke();
    path(b,x=>near(x)+H*.07);b.strokeStyle=S.mixHex(p.front,'#c2c6aa',.38);b.lineWidth=1;b.stroke();
    layer("trees-ground",Math.max(0,hy+H*.35-85));
    const planted=[];
    for(let i=0;i<25;i++){
      const x=rand(i+601)*W,y=geometry.foregroundTree(x,near(x)+10+rand(i+631)*100),size=23+rand(i+711)*47;
      if(planted.some(tree=>Math.abs(tree.x-x)<Math.max(tree.size,size)*.3&&Math.abs(tree.y-y)<22))continue;
      planted.push({x,y,size,variant:rand(i+910)});
    }
    for(const t of planted)paintGroundShadow(b,t.x,t.y,t.size,t.size*.44,p.front);
    // Cached depth bands keep train occlusion correct without repainting foliage each frame.
    for(const band of ['back','front']){
      layer('trees-'+band,Math.max(0,hy+H*.35-85));
      for(const t of planted.filter(t=>geometry.depthBand(t.x,t.y)===band).sort((a,b)=>a.y-b.y))tree(b,t.x,t.y,t.size,S.mixHex(p.front,'#183d32',.25),t.variant);
    }
    const vignette=b.createLinearGradient(0,hy,0,H);vignette.addColorStop(0,'rgba(5,25,27,0)');vignette.addColorStop(1,'rgba(5,25,27,.035)');b.fillStyle=vignette;b.fillRect(0,hy,W,H-hy);
  }
  function cloud(x,y,size,opacity,weather){
    if(weather?.status==='rain'||weather?.status==='thunderstorm'){
      paintRainCloud(g,x,y,size*3.6,size*.72,weather,opacity);g.globalAlpha=1;return;
    }
    g.globalAlpha=opacity;
    const color=S.mixHex('#f8f1dd',p.sky[1],.22+p.night*.62);
    g.beginPath();
    for(const [dx,dy,rx,ry] of [[0,0,1.8,.24],[-.6,-.18,.75,.35],[.2,-.25,.7,.46],[.9,-.09,.66,.27]]){
      g.moveTo(x+(dx+rx)*size,y+dy*size);g.ellipse(x+dx*size,y+dy*size,rx*size,ry*size,0,0,TAU);
    }
    g.fillStyle=color;g.fill();
    g.globalAlpha=1;
  }
  function bird(x,y,size,t,perched=false,twig=false,seed=0,proximity=0){
    const ink=LandscapeAppearance.birdColor(seed,p.night,p.sky[0],proximity);
    if(perched){
      ellipse(g,x,y-.8,size*.6,size*.38,ink);ellipse(g,x+size*.4,y-size*.4,size*.25,size*.25,ink);
      line(g,x-.7,y,x-.7,y+1.5,ink,.6);line(g,x+.7,y,x+.7,y+1.5,ink,.6);return;
    }
    // Wing styling belongs to this bird, not every visitor painted after it.
    g.save();g.strokeStyle=ink;g.lineWidth=1.2;g.lineCap='round';
    g.beginPath();g.moveTo(x-size,y-Math.abs(Math.sin(t*5))*size*.6);g.quadraticCurveTo(x-size*.4,y-size*.4,x,y);g.quadraticCurveTo(x+size*.5,y-size*.6,x+size,y-(perched?0:Math.abs(Math.sin(t*5+.3))*size*.6));g.stroke();
    if(twig&&!perched){line(g,x,y+.4,x+size*.7,y+size*.35,'#8b745a',.55);line(g,x+size*.35,y+size*.2,x+size*.5,y-.1,'#8b745a',.45);}    g.restore();
  }
  function cyclist(x,y,t,color,scale=1,reverse=false,skin=skinColor(0)){
    g.save();g.translate(x,y-3.6*scale);g.rotate(geometry.tangent(trail,x));g.scale((reverse?-1:1)*scale,scale);
    g.strokeStyle=S.mixHex('#253f3b',p.front,p.night*.35);g.lineWidth=1;
    for(const xx of [-5,6]){g.beginPath();g.arc(xx,0,3.6,0,TAU);g.stroke();line(g,xx,0,xx+Math.cos(t*6)*3,Math.sin(t*6)*3,g.strokeStyle,.5);}
    line(g,-5,0,-1,-5,color,1.3);line(g,-1,-5,2,0,color,1.3);line(g,2,0,-5,0,color,1.3);line(g,2,0,6,-5,color,1.3);line(g,6,-5,6,0,color,1);
    // Feet follow opposing pedals instead of remaining glued to the crank axle.
    for(const offset of [.5,0]){
      const leg=geometry.cycleLeg(t,offset);
      line(g,2,0,leg.footX,leg.footY,g.strokeStyle,.7);
      line(g,leg.hipX,leg.hipY,leg.kneeX,leg.kneeY,skin,1.5);
      line(g,leg.kneeX,leg.kneeY,leg.footX,leg.footY,skin,1.2);
      line(g,leg.footX-1,leg.footY,leg.footX+1,leg.footY,color,.8);
    }
    line(g,-1,-6,1,-11,color,2.8);line(g,1,-10,5,-7,skin,1.2);ellipse(g,2,-13,2,2,skin);ellipse(g,2,-14,2.2,1.1,color);
    g.restore();
  }
  function transport(x,y,progress,isTrain,reverse){
    const track=isTrain?geometry.lowerRail:rail,n=isTrain?5:3,cw=isTrain?24:22,dir=reverse?-1:1,scale=isTrain?1:.72;
    const cars=isTrain&&geometry.railCars?geometry.railCars(x,n,(cw+2)*scale,reverse)
      :Array.from({length:n},(_,i)=>{const xx=x-i*(cw+2)*scale*dir;return {x:xx,y:track(xx),angle:geometry.tangent(track,xx)};});
    for(let i=0;i<n;i++){
      const xx=cars[i].x;
      if(isTrain&&i){
        const previous=cars[i-1].x,from=xx+cw/2*scale*dir,to=previous-cw/2*scale*dir;
        line(g,from,track(from)-5,to,track(to)-5,p.city,1.6);
      }
      // The electrified metro rides the viaduct; its supports and deck have
      // their own shade. Only the lower train needs a ground-contact shadow.
      if(isTrain)paintRailVehicleShadow(g,xx,track(xx),11,cw*scale,cars[i].angle,p.front);
      g.save();g.translate(xx,cars[i].y-2);g.rotate(cars[i].angle);g.scale(dir*scale,scale);
      g.fillStyle=S.mixHex(isTrain?'#e4cfa5':'#dceade',p.city,p.night*.3);g.beginPath();g.roundRect(-cw/2,-10,cw,8,2);g.fill();
      g.fillStyle=isTrain?'#bb8275':'#77a8a2';g.fillRect(-cw/2,-5,cw,2);
      g.fillStyle=p.night>.4?'#edce89':'#71969c';for(let j=3;j<cw-3;j+=5)g.fillRect(-cw/2+j,-8,3,2);
      ellipse(g,-cw/2+4,-1,1.5,1.5,p.city);ellipse(g,cw/2-4,-1,1.5,1.5,p.city);g.restore();
    }
  }
  function paintGroundEventShadow(e,depth){
    if(globalThis.LandscapeWinter?.types.includes(e.type))return;
    const f=geometry.routeProgress(e,'x'),progress=e.reverse?1-f:f;
    const x=-160+progress*(W+320),fade=S.smooth(0,.06,f)*(1-S.smooth(.94,1,f));
    g.save();g.globalAlpha*=fade;
    if(e.type==='cyclist'){
      geometry.pack(x,e.count||S.groupSize('cyclist',e.seed),e.reverse).forEach(pose=>
        paintGroundShadow(g,pose.x,trail(pose.x),15,12,p.hill));
    }else if(['reader','picnic','couple','kite'].includes(e.type)){
      const visit=geometry.visitPose(e,geometry.motionProgress(e,'x'));
      for(const offset of e.type==='picnic'||e.type==='couple'?[-11,11]:[0]){
        const xx=visit.x+offset;paintGroundShadow(g,xx,trail(xx)+20,14,7,p.hill);
      }
    }else if(['walker','dogwalker','rabbit','deer'].includes(e.type)){
      const pose=geometry.groundPose(e.type==='dogwalker'?'walker':e.type,e);
      paintGroundShadow(g,pose.x,pose.y,e.type==='deer'?18:e.type==='rabbit'?6:14,e.type==='deer'?15:7,p.hill);
      if(e.type==='dogwalker'){
        const dog=geometry.dogPose(pose.x,pose.distance,pose.direction);
        paintGroundShadow(g,dog.x,dog.y,7,9,p.hill);
      }
    }else if(['skateboarder','rollerskater','hoverboard','scooter'].includes(e.type)){
      paintGroundShadow(g,x,trail(x),18,12,p.hill);
    }else if(e.type==='abduction'){
      const lift=Math.sin(S.clamp((geometry.motionProgress(e,'y')-.25)/.5)*Math.PI);
      if(lift<.1){
        const xx=W*(.18+e.lane*.62);
        paintGroundShadow(g,xx,middle(xx)+30,8,10,p.hill);
      }
    }
    g.restore();
  }
  function paintFestivalBarge(e){
    if(sky.sun.altitude>=-6)return;
    const pose=geometry.festival(e);
    // The whole stage mirrors about its own floating hull, using the same
    // shoreline clipping and depth-sorted pass as the other vessels.
    reflectWaterObject(pose.y,()=>paintFestival(e));
    g.save();path(g,far);g.lineTo(W,geometry.waterTop);g.lineTo(0,geometry.waterTop);g.closePath();g.clip();
    for(let i=0;i<5;i++){
      const phase=(e.age*.35+i*.19)%1,xx=pose.x-pose.direction*(pose.width*.62+i*4*pose.scale);
      g.globalAlpha=(1-phase)*.22;
      line(g,xx,pose.y+pose.scale+phase*3*pose.scale,xx-pose.direction*(12+phase*9)*pose.scale,pose.y+pose.scale+phase*3*pose.scale,p.sky[2],.7*pose.scale);
    }
    g.restore();paintFestival(e);
  }
  function paintFestival(e){
    const pose=geometry.festival(e),night=1-S.smooth(-12,-6,sky.sun.altitude);
    if(!pose.alpha||!night)return;
    const {x,y,scale}=pose,w=56,h=28,hullDepth=3,inks=['#7be5ed','#bd9af6','#f4b982'];
    const launcherOffset=pose.launcherOffset/scale,launcherTop=pose.launcherTop/scale,launcherBottom=pose.launcherBottom/scale;
    const ink=inks[Math.floor(e.seed*3)%3],second=inks[(Math.floor(e.seed*3)+1)%3];
    g.save();g.translate(x,y);g.scale(scale,scale);g.globalAlpha*=pose.alpha*night;
    // The stage, crowd, launch racks and hull travel as one vehicle. Steady
    // colored light and slow beam sweeps never pulse the scene brightness.
    g.fillStyle='#172b39';g.beginPath();g.moveTo(-w*.64,-3);g.lineTo(w*.64,-3);
    g.lineTo(w*.56,hullDepth);g.lineTo(-w*.56,hullDepth);g.closePath();g.fill();
    line(g,-w*.61,-3,w*.61,-3,'#889cac',1.6);
    line(g,-w*.56,hullDepth-1,w*.56,hullDepth-1,'#4b687a',1);
    for(const side of [-1,1]){
      line(g,side*launcherOffset,launcherBottom,side*launcherOffset,launcherTop,'#677c89',pose.launcherRailWidth/scale);
      for(const offset of pose.launcherPadOffsets)ellipse(g,side*(launcherOffset-offset/scale),1,
        pose.launcherPadRadius/scale,pose.launcherPadRadius/scale,'#a9baca');
    }
    for(const side of [-1,1]){
      g.save();g.translate(side*w*.35,-h*.75);g.rotate(side*.27+pose.beamAngle);
      const beam=g.createLinearGradient(0,0,0,-h*2.1);
      beam.addColorStop(0,ink+'22');beam.addColorStop(1,ink+'00');
      g.fillStyle=beam;g.beginPath();g.moveTo(-1,0);g.lineTo(-h*.48,-h*2.1);g.lineTo(h*.48,-h*2.1);g.lineTo(1,0);g.fill();g.restore();
    }
    g.fillStyle='#152736';g.fillRect(-w*.43,-h*.73,w*.86,h*.62);
    // Roof chevrons, trusses and speaker stacks keep the silhouette legible
    // at panorama scale; the LEDs never blink or use additive compositing.
    for(const side of [-1,1]){
      line(g,0,-h,side*w*.46,-h*.65,ink,1.3);
      line(g,0,-h*.86,side*w*.31,-h*.59,second,.9);
      line(g,side*w*.43,-h*.75,side*w*.43,-h*.12,'#7b8d99',1.4);
      g.fillStyle='#10222d';g.fillRect(side*w*.34-w*.045,-h*.61,w*.09,h*.42);
      for(let i=0;i<3;i++)ellipse(g,side*w*.34,-h*(.25+i*.13),w*.021,h*.05,'#3a4e59');
      line(g,side*w*.49,-h*.10,side*w*.49,-h*.77,'#637687',.8);
      g.fillStyle=second;g.beginPath();g.moveTo(side*w*.49,-h*.77);g.lineTo(side*w*.49+side*w*.075,-h*.69);g.lineTo(side*w*.49,-h*.61);g.fill();
    }
    const screen=g.createLinearGradient(-w*.23,-h*.6,w*.23,-h*.28);
    screen.addColorStop(0,ink+'77');screen.addColorStop(1,second+'88');
    g.fillStyle=screen;g.fillRect(-w*.23,-h*.63,w*.46,h*.35);
    g.beginPath();
    for(let i=0;i<=24;i++){
      const xx=-w*.22+i*w*.44/24,yy=-h*.45+Math.sin(i*.63+e.age*.6)*h*.055;
      if(i)g.lineTo(xx,yy);else g.moveTo(xx,yy);
    }
    g.strokeStyle=ink;g.lineWidth=.7;g.stroke();
    g.fillStyle='#233749';g.fillRect(-w*.16,-h*.27,w*.32,h*.10);
    line(g,-w*.16,-h*.27,w*.16,-h*.27,second,1);
    ellipse(g,0,-h*.35,1.6,1.7,'#d8b596');line(g,0,-h*.33,0,-h*.27,'#c4d3d3',2);
    line(g,-w*.46,-h*.1,w*.46,-h*.1,ink,.8);
    // All passengers remain attached to the deck throughout the crossing.
    for(let i=0;i<12;i++){
      const xx=(i/11-.5)*w*.82,yy=-2-(i%3)*1.8,bob=Math.sin(pose.crowdPhase+i*1.7)*.6;
      const shirt=i%4===0?S.mixHex(ink,'#182936',.55):'#243440';
      line(g,xx,yy,xx,yy-3.5+bob,shirt,1.7);ellipse(g,xx,yy-5+bob,1.2,1.25,'#788c99');
      if(i%3===0){line(g,xx,yy-3,xx-2,yy-5.5+bob,shirt,.8);line(g,xx,yy-3,xx+2,yy-6+bob,shirt,.8);}
    }
    g.restore();
  }
  function paintFireworks(type){
    // The sky labels both solar directions as dawn/dusk below the +8-degree day boundary.
    if(!S.fireworksAllowed(sky))return;
    g.save();
    for(const e of world.events.map(e=>scenePose(e,true)))if(e.type===type&&e.fireworkActive!==false){
      g.save();
      for(const dot of geometry.fireworks(e.age,e.seed,e.type==='festival',e)){
        const night=1-S.smooth(-12,8,sky.sun.altitude);
        const ink=dot.willow?'#ffce88':['#ffd38d','#7de5ef','#cf9fff','#ffa8c5'][(dot.burst+Math.floor(e.seed*4))%4];
        if(dot.trail){
          for(let i=1;i<dot.trail.length;i++){
            const a=dot.trail[i-1],z=dot.trail[i];g.globalAlpha=z.alpha*night*.7;
            line(g,a.x,a.y,z.x,z.y,ink,.45+i*.10);
          }
        }else{g.globalAlpha=dot.alpha*night;line(g,dot.tailX,dot.tailY,dot.x,dot.y,ink,1);}
        if(dot.kind==='rocket')continue;
        const size=dot.size||.9;
        g.globalAlpha=dot.alpha*night*.12;ellipse(g,dot.x,dot.y,size*2.3,size*2.3,ink);
        g.globalAlpha=dot.alpha*night;ellipse(g,dot.x,dot.y,size,size,ink);
      }
      g.restore();
    }
    // Cut only random shows with the actual opaque city, including overlapping
    // towers and the clock. Barge shells have their own foreground pass.
    if(type==='fireworks'){
      g.globalCompositeOperation='destination-out';
      g.drawImage(cityLayer,0,0,cityLayer.width/dpr,cityLayer.height/dpr);
    }
    g.restore();
  }
  function paintClocktowerVisit(){
    if(!clocktowerVisit?.active)return;
    if(sky.sun.altitude>=0){geometry.advanceClocktowerVisit(clocktowerVisit,0,false);return;}
    for(const pose of geometry.clocktowerVisitPoses(clocktowerVisit.active,reduced)){
      if(!pose.visible||pose.alpha<=0)continue;
      const scale=pose.height/7,flight=1-pose.stand,dir=pose.direction;
      const ink=S.mixHex({peter:'#72967b',wendy:'#b1c5ce',john:'#9cabb9',michael:'#bea992'}[pose.character],p.sky[0],.18);
      const headX=pose.x+dir*3.5*flight,headY=pose.y-scale*(3+3*pose.stand);
      const hipX=pose.x-dir*1.6*flight,hipY=pose.y-scale*(1.8+.7*pose.stand),neckY=headY+1.2*scale;
      g.save();g.globalAlpha*=pose.alpha;
      line(g,headX,neckY,hipX,hipY,ink,1.5*scale);
      if(pose.character==='wendy'){
        g.fillStyle=ink;g.beginPath();g.moveTo(headX,neckY);g.lineTo(hipX-1.3*scale,hipY+.2);g.lineTo(hipX+1.3*scale,hipY+.2);g.fill();
      }
      for(const foot of pose.feet)line(g,hipX,hipY,foot.x,foot.y,ink,.7*scale);
      const armX=headX+dir*scale*(.8+3*flight),armY=neckY+scale*(1.6-2.1*flight);
      line(g,headX,neckY,armX,armY,ink,.65*scale);
      line(g,headX,neckY,headX-dir*1.5*scale,neckY+scale*(1.5-.8*flight),ink,.65*scale);
      ellipse(g,headX,headY,.8*scale,.9*scale,ink);
      if(pose.character==='peter'){
        g.fillStyle=ink;g.beginPath();g.moveTo(headX-1*scale,headY-.4);g.lineTo(headX+dir*2*scale,headY-1.7*scale);g.lineTo(headX+1*scale,headY-.4);g.fill();
      }else if(pose.character==='john'){
        g.fillStyle=ink;g.fillRect(headX-.6*scale,headY-1.8*scale,1.2*scale,1*scale);line(g,headX-1.2*scale,headY-.8*scale,headX+1.2*scale,headY-.8*scale,ink,.5);
      }else if(pose.character==='michael')ellipse(g,armX,armY+.4,.55,.65,ink);
      g.restore();
    }
  }
  function paintLife(t){
    visibleBanners=[];if(reduced)t=0;
    const paintEvents=world.events.map(scenePose);
    const weather=S.weatherAt(new Date(),sceneSeason),weatherPhase=reduced?0:Date.now()/1000;
    g.clearRect(0,0,W,H);
    paintFireworks('fireworks');
    const waterEvents=new Set(['festival','jetski','sailboat','cruise','yacht','windsurfer','duck','fish','dolphin']);
    const airborne=new Set(['festival','duck','fish','plane','balloon','airshow','banner','skywriter','hangglider','jetski','sailboat','cruise','yacht','windsurfer','dolphin','flock']);
    for(const e of paintEvents)if(e.type==='meteor'&&p.night>.3){
      const fx=geometry.motionProgress(e,'x'),fy=geometry.motionProgress(e,'y'),dx=(e.reverse?-1:1)*(85+e.seed*70),dy=24+e.lane*20;
      const sx=W*(.2+e.seed*.6),sy=hy*(.08+e.lane*.3),x=sx+dx*fx,y=sy+dy*fy;
      g.save();g.globalAlpha=p.night*S.smooth(0,.08,fx)*(1-S.smooth(.55,1,fx));
      const tail=g.createLinearGradient(x-dx*.35,y-dy*.35,x,y);tail.addColorStop(0,'#e7f5ee00');tail.addColorStop(1,'#effbf5');
      line(g,x-dx*.35,y-dy*.35,x,y,tail,1.1);ellipse(g,x,y,1.2,1.2,'#f9ffe8');g.restore();
    }
    paintFireworks('festival');
    // Persistent drift guarantees life even between scheduled arrivals. In reduced
    // motion these exact same shapes are drawn once, with no animation loop.
    for(const pose of sceneSnapshot.clouds){
      const size=(W<600?18:27)+pose.size*30;
      const x=reduced?(rand(pose.index+71)*1.2-.1)*W:pose.x*W;
      cloud(x,25+pose.y*hy,size,pose.opacity,weather);
    }
    // Paint moving sky visitors once, then collect every visible layer above
    // the horizon. New visitors and weather can enter the lake without a
    // separate reflection rule for each type.
    for(const e of paintEvents)if(airborne.has(e.type)&&!waterEvents.has(e.type))paintEvent(e,t);
    paintRooftopParty();
    paintClocktowerVisit();
    const reflectionHeight=Math.max(1,Math.floor(geometry.waterTop*dpr));
    if(skyReflection.width!==front.width)skyReflection.width=front.width;
    if(skyReflection.height!==reflectionHeight)skyReflection.height=reflectionHeight;
    const reflectionContext=skyReflection.getContext('2d');
    reflectionContext.setTransform(1,0,0,1,0,0);
    reflectionContext.clearRect(0,0,skyReflection.width,skyReflection.height);
    reflectionContext.setTransform(dpr,0,0,dpr,0,0);
    reflectionContext.drawImage(skyCity,0,0,skyCity.width,skyCity.height,0,0,W,geometry.waterTop);
    reflectionContext.drawImage(front,0,0,front.width,skyReflection.height,0,0,W,geometry.waterTop);
    paintWeatherOn(reflectionContext,weather,weatherPhase,false,false,false);
    // Downsampling makes a faint soft copy; deeper water blends in a little
    // more of it without moving or shrinking any reflected object.
    const softWidth=Math.max(1,Math.ceil(skyReflection.width/3)),softHeight=Math.max(1,Math.ceil(skyReflection.height/3));
    if(blurredReflection.width!==softWidth)blurredReflection.width=softWidth;
    if(blurredReflection.height!==softHeight)blurredReflection.height=softHeight;
    const softContext=blurredReflection.getContext('2d');
    softContext.setTransform(1,0,0,1,0,0);softContext.clearRect(0,0,softWidth,softHeight);
    softContext.imageSmoothingEnabled=true;softContext.imageSmoothingQuality='high';
    softContext.drawImage(skyReflection,0,0,blurredReflection.width,blurredReflection.height);
    // Blend the same light softness by water depth before mirroring. Shifting
    // separate source rows made small round objects look stepped and pixelated.
    const surface=geometry.reflectionSurface(p.night);
    if(softenedReflection.width!==skyReflection.width)softenedReflection.width=skyReflection.width;
    if(softenedReflection.height!==skyReflection.height)softenedReflection.height=skyReflection.height;
    const softened=softenedReflection.getContext('2d');
    softened.setTransform(1,0,0,1,0,0);softened.globalCompositeOperation='source-over';
    softened.clearRect(0,0,softenedReflection.width,softenedReflection.height);
    softened.setTransform(dpr,0,0,dpr,0,0);
    softened.drawImage(blurredReflection,0,0,blurredReflection.width,blurredReflection.height,0,0,W,geometry.waterTop);
    softened.globalCompositeOperation='destination-in';
    const softness=softened.createLinearGradient(0,geometry.waterTop-surface.softDepth,0,geometry.waterTop);
    softness.addColorStop(0,`rgba(0,0,0,${surface.softMax})`);softness.addColorStop(1,'rgba(0,0,0,0)');
    softened.fillStyle=softness;softened.fillRect(0,0,W,geometry.waterTop);
    if(reflectionCanvas.width!==skyReflection.width)reflectionCanvas.width=skyReflection.width;
    if(reflectionCanvas.height!==skyReflection.height)reflectionCanvas.height=skyReflection.height;
    const mirror=reflectionCanvas.getContext('2d');
    mirror.setTransform(1,0,0,1,0,0);mirror.clearRect(0,0,reflectionCanvas.width,reflectionCanvas.height);
    mirror.setTransform(dpr,0,0,dpr,0,0);
    mirror.drawImage(skyReflection,0,0,skyReflection.width,skyReflection.height,0,0,W,geometry.waterTop);
    mirror.drawImage(softenedReflection,0,0,softenedReflection.width,softenedReflection.height,0,0,W,geometry.waterTop);
    // Match skyline opacity with a flat slope at contact. A three-pixel
    // linear fade produced a conspicuous straight rule across the water.
    mirror.globalCompositeOperation='destination-in';
    const contact=mirror.createLinearGradient(0,geometry.waterTop-surface.contactDepth,0,geometry.waterTop);
    for(let i=0;i<=16;i++){
      const depth=surface.contactDepth*(1-i/16);
      contact.addColorStop(i/16,`rgba(0,0,0,${surface.contactAlpha(depth)})`);
    }
    mirror.fillStyle=contact;mirror.fillRect(0,0,W,geometry.waterTop);
    mirror.globalCompositeOperation='source-over';
    const lakeContact=Math.floor(geometry.waterTop*dpr)/dpr-1/dpr;
    g.save();path(g,far);g.lineTo(W,lakeContact);g.lineTo(0,lakeContact);g.closePath();g.clip();
    if(p.night>.05){
      const reflectedSky=g.createLinearGradient(0,geometry.waterTop,0,geometry.waterTop+H*.12);
      reflectedSky.addColorStop(0,p.sky[2]);reflectedSky.addColorStop(1,p.sky[0]);
      g.globalAlpha=p.night*.18;g.fillStyle=reflectedSky;g.fillRect(0,geometry.waterTop,W,H*.12);
    }
    paintHorizonReflection(reflectionCanvas,t,1);
    const reflection=point(sky.sun.azimuth,0).x;
    if(geometry.sunReflection(sky.sun))for(let i=0;i<24;i++){
      const wave=geometry.ripple(i,t,wind),y=geometry.waterTop+5+i*H*.0035,w=(5+i*1.9)*wave.width;
      const x=reflection+wave.drift;
      g.globalAlpha=.7*(1-i/28)*wave.alpha;
      line(g,x-w,y,x+w,y,'#fff6d7',1);
    }
    for(let i=0;i<40;i++){
      const wave=geometry.ripple(i+30,t,wind),x=rand(i+403)*W+wave.drift,y=geometry.waterTop+rand(i+402)*H*.09;
      g.globalAlpha=wave.alpha*.20;line(g,x,y,x+(7+rand(i+480)*22)*wave.width,y,S.mixHex(p.sky[1],'#ffffff',.6),.8);
    }
    g.restore();
    const water=new Set(['festival','jetski','sailboat','cruise','yacht','windsurfer','duck','fish','dolphin']);
    // Arrival order cannot decide which overlapping boat or animal is in front.
    for(const e of paintEvents.filter(e=>water.has(e.type)).sort((a,b)=>geometry.waterDepth(a,t)-geometry.waterDepth(b,t))){
      if(e.type==='festival')paintFestivalBarge(e);
      else if(['duck','fish','dolphin'].includes(e.type))paintEvent(e,t);else paintVessel(e,t);
    }
    // The metro runs below the reflection source but in front of the lake.
    // Painting it here keeps the water overlay from darkening its visible cars.
    for(const e of paintEvents)if(e.type==='metro')paintEvent(e,t);
    composite('middle');
    // Ground contact determines occlusion, including props previously baked into the hill.
    const groundPass=paintEvents.filter(e=>!airborne.has(e.type)&&e.type!=='metro'&&e.type!=='train'&&e.type!=='snowangel').map(e=>{
      const depth=globalThis.LandscapeWinter?.types.includes(e.type)?LandscapeWinter.pose(e.type,e,geometry,W,H).y:geometry.eventDepth(e);
      return {depth,draw:()=>{paintGroundEventShadow(e,depth);paintEvent(e,t);}};
    });
    if(sceneSeason!=='winter'&&W>650&&visitSeed>.25)groundPass.push({depth:trail(W*.43)+15,draw:paintIceCreamStand});
    for(const item of groundPass.sort((a,b)=>a.depth-b.depth))item.draw();
    if(W>850&&visitSeed>.45){
      const fx=W*.54,fy=trail(fx)+24;
      ellipse(g,fx,fy,11,3,S.mixHex(p.city,'#e8e4d1',.6));ellipse(g,fx,fy-1,8,2,p.sky[1]);
      if(sceneSeason!=='winter')for(let i=-1;i<=1;i++){g.beginPath();g.moveTo(fx,fy);g.quadraticCurveTo(fx+i*7,fy-20+Math.sin(t*wind)*2,fx+i*7,fy-1);g.strokeStyle=S.mixHex(p.sky[1],'#ffffff',.6);g.lineWidth=1;g.stroke();}
    }
    composite('front');
    composite('trees-ground');
    for(const e of paintEvents)if(e.type==='snowangel')paintEvent(e,t);
    for(let i=0;i<12;i++){const x=rand(i+1700)*W,y=Math.min(H+5,near(x)+85+rand(i+1710)*100);line(g,x,y,x+Math.sin(t*.8+i)*3,y-16,S.mixHex(p.front,'#bdd8a5',.4));}
    composite('trees-back');
    for(const e of paintEvents)if(e.type==='train')paintEvent(e,t);
    for(const e of woodland.events)paintWoodland(scenePose(e));
    composite('trees-front');
    paintWeatherOn(g,weather,weatherPhase,true);
    if(sceneSeason!=='winter'&&p.night>.15)for(let i=0;i<32;i++){
      const x=rand(i+801)*W+Math.sin(t*.7+i)*10;
      const y=Math.min(H-8,near(x)+16+rand(i+830)*44+Math.cos(t+i)*6);
      g.globalAlpha=(.2+.6*(.5+.5*Math.sin(t*1.4+i)))*p.night;ellipse(g,x,y,1.5,1.5,'#eff7b7');g.globalAlpha=1;
    }
  }
  function paintWeatherOn(ctx,weather,phase,updateStatus=false,includeTint=true,includeRain=true){
    if(updateStatus)document.documentElement.dataset.sceneWeather=weather.status;
    LandscapeSeasonal.paint(ctx,treeOrigins,geometry,W,H,world.elapsed,sceneSeason,p,reduced,weather);
    if(!weather.intensity)return;
    const snow=weather.status==='snow'||weather.status==='snowstorm',storm=weather.storm;
    const gust=Math.sin(phase*.22)+Math.sin(phase*.071)*.5,wind=storm?2.3+gust:.5+gust*.15;
    ctx.save();
    // A sky-only rectangle left a straight grey boundary across the water and
    // hills. Carry the weather tint down the whole scene and let it disappear.
    // The reflection receives clouds, without a second tint or inverted rain.
    if(includeTint){
      ctx.globalAlpha=weather.intensity*(snow?.08:storm?.32:.22);
      const tint=ctx.createLinearGradient(0,0,0,H);
      tint.addColorStop(0,'rgba(36,55,70,1)');
      tint.addColorStop(.4,'rgba(36,55,70,.72)');
      tint.addColorStop(.78,'rgba(36,55,70,.17)');
      tint.addColorStop(1,'rgba(36,55,70,0)');
      ctx.fillStyle=tint;ctx.fillRect(0,0,W,H);
    }
    ctx.globalAlpha=weather.intensity*(snow?.43:storm?.70:.58)*(1-.12*p.night);
    for(let i=0;i<6;i++){
      const x=( ((i+.3)/6+phase*(storm?3:1)/1440/1.125)%1.125)*W-W*.0625;
      const y=hy*(.13+rand(i+6100)*.22),w=W*(.18+rand(i+6200)*.11),h=hy*(.075+rand(i+6300)*.05);
      paintRainCloud(ctx,x,y,w,h,weather,ctx.globalAlpha);
    }
    if(snow||includeRain){
      ctx.globalAlpha=weather.intensity*(snow?.55:(storm?.72:.62)*.5);
      // Width alone left tall phone scenes nearly empty. Preserve the snow
      // budget while giving rain a dense floor and coverage for taller screens.
      // Scale the existing capped rain budget through twilight. Seeded prefixes
      // survive day/night repaint; the doubled night ceiling remains bounded.
      const rainCount=Math.min(900,Math.ceil(Math.max(W/(storm?2.5:3),W*H/(storm?2200:3000))));
      const count=snow?Math.round(W/(storm?8:22)):Math.ceil(rainCount*(1+p.night));
      for(let i=0;i<count;i++){
        const speed=snow?10+rand(i+4500)*15:(75+rand(i+4500)*50)*2;
        const y=(rand(i+4600)*H+phase*speed)%H;
        const x=((rand(i+4700)*W+y*.12*wind+(snow?phase*(storm?18:4)+Math.sin(phase*.22)*12+Math.sin(phase*.071)*8+Math.sin(phase*.5+i)*5:0))%W+W)%W;
        if(snow)ellipse(ctx,x,y,.8+rand(i+4800),.8+rand(i+4800),'#f4f4e8');
        else line(ctx,x,y,x+1.2*wind,y+9+rand(i+4800)*7,'#e4f2f6',.9);
      }
    }
    // An occasional distant bolt, never a full-screen flash or a reduced-motion effect.
    const flash=(phase+rand(weather.slot)*40)%47;
    if(storm&&!snow&&!reduced&&flash<.28){
      ctx.globalAlpha=weather.intensity*Math.sin(flash/.28*Math.PI)*.6;
      const x=W*(.15+rand(Math.floor(phase/47))* .7),y=hy*.13;
      line(ctx,x,y,x-5,y+12,'#fff4d1',1);line(ctx,x-5,y+12,x+2,y+10,'#fff4d1',1);line(ctx,x+2,y+10,x-6,y+24,'#fff4d1',1);
    }
    ctx.restore();
  }
  function paintRainCloud(ctx,x,y,w,h,weather,opacity){
    const snow=weather.status==='snow'||weather.status==='snowstorm',storm=weather.storm;
    ctx.save();ctx.globalAlpha=opacity;
    // Pale daytime highlights became luminous stickers after sunset. Blend
    // every lobe shade with the sky's continuous night fraction instead.
    const daylight=snow?['#eef0e9','#c7d2d2','#a6bac1']:
      storm?['#b7c9ca','#8fa8b0','#6d8996']:['#d0ded8','#adc5c7','#8eabb3'];
    const afterDark=snow?['#687a85','#526875','#405866']:
      storm?['#4b5f70','#394e60','#253c4e']:['#5d7180','#43596b','#31495b'];
    const cloudShades=daylight.map((ink,index)=>S.mixHex(ink,afterDark[index],p.night));
      // Uneven lobes and a bowed underside read as a single cloud, while the
      // vertical shading keeps its weight without opaque floating discs.
      const shade=ctx.createLinearGradient(0,y-h,0,y+h*.65);
      shade.addColorStop(0,cloudShades[0]);
      shade.addColorStop(.55,cloudShades[1]);
      shade.addColorStop(1,cloudShades[2]);
      ctx.fillStyle=shade;ctx.beginPath();ctx.moveTo(x-w*.5,y+h*.25);
      ctx.bezierCurveTo(x-w*.63,y-h*.10,x-w*.47,y-h*.32,x-w*.35,y-h*.30);
      ctx.bezierCurveTo(x-w*.34,y-h*.80,x-w*.12,y-h*.91,x+w*.01,y-h*.57);
      ctx.bezierCurveTo(x+w*.13,y-h*.97,x+w*.35,y-h*.78,x+w*.37,y-h*.39);
      ctx.bezierCurveTo(x+w*.56,y-h*.38,x+w*.64,y-h*.08,x+w*.49,y+h*.25);
      ctx.bezierCurveTo(x+w*.34,y+h*.49,x+w*.22,y+h*.38,x+w*.08,y+h*.42);
      ctx.bezierCurveTo(x-w*.08,y+h*.54,x-w*.26,y+h*.40,x-w*.38,y+h*.37);
      ctx.bezierCurveTo(x-w*.47,y+h*.34,x-w*.49,y+h*.31,x-w*.5,y+h*.25);
      ctx.closePath();ctx.fill();
    ctx.restore();
  }
  function paintWoodland(e){
    const pose=geometry.woodlandPose(e),f=geometry.motionProgress(e,'x'),deer=e.type==='deer',rabbit=e.type==='rabbit',fox=e.type==='fox';
    const fur=S.mixHex(deer?'#bda181':rabbit?'#a99d88':fox?'#b7764f':'#92958c',p.front,p.night*.45);
    const bodyY=deer?-11:rabbit?-4:-6,hipY=deer?-9:-4,half=deer?7:rabbit?3:5;
    g.save();g.globalAlpha=S.smooth(0,.1,f)*(1-S.smooth(.85,1,f));
    paintGroundShadow(g,pose.x,pose.y,deer?19:rabbit?8:11,(half+2)*pose.scale*2,p.front);
    g.translate(pose.x,pose.y);g.scale(pose.direction*pose.scale,pose.scale);
    for(const [hip,offset] of [[-half*.65,0],[half*.65,.5]]){
      const step=geometry.strideFoot(pose.distance/pose.scale,5,offset),kneeX=hip+step.x*.45;
      const footX=pose.x+pose.direction*pose.scale*(hip+step.x);
      const footY=(Math.max(geometry.near(footX)+18,H-28-e.seed*25)-pose.y)/pose.scale-step.lift*.4;
      line(g,hip,hipY,kneeX,hipY*.5,fur,deer?1.5:1.8);line(g,kneeX,hipY*.5,hip+step.x,footY,fur,deer?1.2:1.6);
    }
    if(fox){line(g,-half,bodyY,-half-7,bodyY+3,fur,4);line(g,-half-7,bodyY+3,-half-9,bodyY+2,'#ddd0b6',2.5);}
    if(e.type==='raccoon'){line(g,-half,bodyY,-half-6,bodyY+3,fur,3);for(let i=1;i<4;i++)line(g,-half-i*1.6,bodyY+i*.7,-half-i*1.6,bodyY+i*.7+1.5,p.city,1.3);}
    ellipse(g,0,bodyY,half,deer?4:rabbit?3:3.2,fur);
    const hx=half,hy=deer?-18:rabbit?-7:-8;
    if(deer)line(g,half-2,bodyY,half,hy,fur,3);
    ellipse(g,hx,hy,deer?2.8:2,2.2,fur);ellipse(g,hx+2,hy+.6,1.6,.9,fur);
    line(g,hx-1,hy-1,hx-2,hy-(rabbit?7:4),fur,rabbit?1.6:1.4);
    line(g,hx+1,hy-1,hx+1,hy-(rabbit?6:4),fur,1.2);
    if(e.type==='raccoon')line(g,hx,hy,hx+2,hy,p.city,1.4);
    ellipse(g,hx+1.3,hy-.3,.45,.45,p.city);g.restore();
  }
  function reflectWaterObject(waterY,paint){
    // Each visitor mirrors around its own contact with the water. Both clips
    // keep the upright body above the surface and its mirror out of the shore.
    // One device pixel of overlap covers the antialiased gap at a floating hull.
    const contactY=waterY-1/dpr;
    g.save();path(g,far);g.lineTo(W,geometry.waterTop);g.lineTo(0,geometry.waterTop);g.closePath();g.clip();
    g.beginPath();g.rect(0,contactY,W,Math.max(0,H-contactY));g.clip();
    g.globalAlpha*=.22+p.night*.12;
    g.translate(0,2*contactY);g.scale(1,-1);
    paint();g.restore();
  }
  function paintVessel(e,t){

    const fx=geometry.routeProgress(e,'x'),progress=e.reverse?1-fx:fx;
    const pose=geometry.vessel(e.type,e.lane,-160+progress*(W+320),geometry.motionAge(e,'y'),e.reverse);
    if(!pose.visible)return;
    const {x,y,scale,direction}=pose,c=color(e.seed),hull=S.mixHex('#fff3dd',p.sky[1],p.night*.4);
    const length=e.type==='cruise'?72:e.type==='yacht'?39:e.type==='sailboat'?28:16;
    // Wakes are clipped to the lake, while masts may rise above the waterline.
    g.save();path(g,far);g.lineTo(W,geometry.waterTop);g.lineTo(0,geometry.waterTop);g.closePath();g.clip();
    for(let i=0;i<7;i++){
      const phase=(t*(e.type==='jetski'?1.7:.6)+i*.14)%1;
      g.globalAlpha=(1-phase)*.3;const wx=x-direction*(length*.35+i*5)*scale;
      line(g,wx,y+(1+phase*3)*scale,wx-direction*(8+phase*8)*scale,y+(1+phase*3)*scale,p.sky[2],scale);
    }g.restore();
    const paintVesselShape=()=>{
    if(e.type==='windsurfer'){
      // Board sits at the waterline; the rider leans back against the sail.
      line(g,-10,0,10,0,c,2);line(g,0,0,4,-27,p.city,.8);
      g.beginPath();g.moveTo(4,-27);g.lineTo(14,-6);g.lineTo(1,-5);g.closePath();g.fillStyle=color(e.seed,2);g.fill();
      line(g,4,-24,10,-9,hull,.7);
      const skin=skinColor(e.seed);
      line(g,-6,-1,-8,-8,p.city,1.4);line(g,-2,-1,-8,-8,p.city,1.4);
      line(g,-8,-8,-6,-15,c,2.5);personHead(g,-5,-18,1.8,1.8,e.seed,skin);
      line(g,-6,-14,3,-12,skin,1.2);line(g,0,-12,8,-12,p.city,.7);
    }else if(e.type==='jetski'){
      g.fillStyle=c;g.beginPath();g.moveTo(-9,-2);g.lineTo(6,-3);g.lineTo(10,-1);g.lineTo(5,2);g.lineTo(-6,2);g.closePath();g.fill();
      line(g,-2,-3,1,-7,color(e.seed,2),3);personHead(g,2,-9,1.8,1.8,e.seed,skinColor(e.seed));line(g,1,-6,6,-4,skinColor(e.seed),1.2);line(g,5,-4,7,-4,p.city,1);
    }else{
      g.fillStyle=hull;g.beginPath();g.moveTo(-length/2,-4);g.lineTo(length/2,-4);g.lineTo(length/2-7,3);g.lineTo(-length/2+4,3);g.closePath();g.fill();
      line(g,-length/2+3,1,length/2-4,1,c,2);
      if(e.type==='sailboat'){
        line(g,0,-4,0,-31,p.city,.8);
        g.beginPath();g.moveTo(-1,-29);g.lineTo(-1,-6);g.lineTo(-15,-6);g.closePath();g.fillStyle=hull;g.fill();
        g.beginPath();g.moveTo(2,-26);g.lineTo(2,-6);g.lineTo(13,-6);g.closePath();g.fillStyle=color(e.seed,2);g.fill();
        personHead(g,5,-5,1.4,1.4,e.seed,skinColor(e.seed));
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
    };
    const drawVessel=()=>{
      g.save();g.translate(x,y);g.scale(direction*scale,scale);paintVesselShape();g.restore();
    };
    // Boards and jet skis sit shallower than boat hulls; mirror at the painted draft.
    const hullDraft=e.type==='windsurfer'?1:e.type==='jetski'?2:3;
    reflectWaterObject(y+hullDraft*scale,drawVessel);
    drawVessel();
  }
  function paintIceCreamStand(){
    const ax=W*.43,ay=trail(ax)+15;
    paintGroundShadow(g,ax,ay,16,21,p.hill);
    g.fillStyle=color(visitSeed);g.fillRect(ax-9,ay-12,18,12);
    for(let i=0;i<4;i++){g.fillStyle=i%2?'#fff0d6':color(visitSeed,2);g.fillRect(ax-11+i*5.5,ay-16,5.5,5);}
    ellipse(g,ax,ay-7,2,2,'#fff0d6');g.fillStyle='#c39877';g.fillRect(ax-1,ay-5,2,3);
  }
  function paintEvent(e,t){
      if(LandscapeRiders.types.includes(e.type)){
        LandscapeRiders.paint(g,geometry,W,e,t,p,{ellipse,line,color,skinColor,personHead});return;
      }
      if(globalThis.LandscapeWinter?.types.includes(e.type)){
        LandscapeWinter.paint(g,geometry,W,H,e,t,p,{ellipse,line,color,skinColor,personHead,S,groundShadow:paintGroundShadow});return;
      }
      if(['jetski','sailboat','cruise','yacht','windsurfer'].includes(e.type))return;
      const f=geometry.routeProgress(e,'x'),fy=geometry.motionProgress(e,'y'),clock=geometry.motionAge(e,'x'),verticalClock=geometry.motionAge(e,'y'),progress=e.reverse?1-f:f,x=-160+progress*(W+320);
      if(e.type==='metro'){transport(x,rail(x)-4,f,false,e.reverse);return;}
      if(e.type==='train'){transport(x,near(x)+H*.07-2,f,true,e.reverse);return;}
      if(e.type==='cyclist'){
        const count=e.count||S.groupSize('cyclist',e.seed);
        geometry.pack(x,count,e.reverse).forEach((pose,i)=>cyclist(pose.x,trail(pose.x),clock+i*.8,color(e.seed,i),W<600?.85:1,e.reverse,skinColor((e.seed+i*.173)%1)));
        return;
      }
      if(e.type==='flock'){
        const y=hy*(.25+e.lane*.32)+geometry.verticalOffset(e,18);
        geometry.flock(x,y,e.reverse,e.count||S.groupSize('flock',e.seed)).forEach((pose,i)=>bird(pose.x,pose.y,2.5,clock+i*.13,false,false,(e.seed+i*.173)%1,0));
        return;
      }
      if(e.type==='bird'){
        if(sky.sun.altitude < -8)return;
        const nest=geometry.nest();
        const vertical=typeof fy==='number'?fy:f,flightClock=typeof clock==='number'?clock:t;
        // Finish the visit with a takeoff and an offscreen exit, so expiring the
        // event cannot make a perched bird abruptly disappear from its nest.
        for(let i=0;i<(e.seed>.4?2:1);i++){
          const pose=geometry.nestVisit(f,e.lane,e.reverse,nest.perches[i],i,vertical);
          bird(pose.x,pose.y,i?3:3.5,flightClock+i*.6,pose.perched,pose.twig,(e.seed+i*.173)%1,S.smooth(hy*.4,nest.y,pose.y));
        }
        return;
      }
      if(e.type==='plane'){
        const y=hy*.18+e.lane*hy*.18+geometry.verticalOffset(e,14);
        g.save();g.translate(x,y);g.scale(e.reverse?-1:1,1);
        g.globalAlpha=.45;const tail=g.createLinearGradient(-90,0,-6,0);tail.addColorStop(0,'rgba(248,246,225,0)');tail.addColorStop(1,'rgba(248,246,225,.65)');g.fillStyle=tail;g.fillRect(-90,1,83,.7);g.globalAlpha=1;
        g.fillStyle=S.mixHex('#f6f1db',p.sky[1],p.night*.7);g.beginPath();g.moveTo(9,0);g.lineTo(0,-2);g.lineTo(-7,-8);g.lineTo(-10,-8);g.lineTo(-5,-1);g.lineTo(-13,-1);g.lineTo(-17,-4);g.lineTo(-18,-3);g.lineTo(-16,2);g.lineTo(-5,2);g.lineTo(-10,8);g.lineTo(-7,8);g.lineTo(0,2);g.closePath();g.fill();
        if(p.night>.4){ellipse(g,0,-2,1,1,'#ed8976');ellipse(g,0,2,1,1,'#abcdaa');}g.restore();return;
      }
      if(e.type==='balloon'){
        const drift=geometry.balloonDrift(e.seed,clock,wind,verticalClock),y=hy*.48+e.lane*hy*.18+drift.y+geometry.verticalOffset(e,10),r=10+e.lane*7;
        g.save();g.translate(x,y);ellipse(g,0,0,r,r*1.2,color(e.seed));ellipse(g,0,0,r*.62,r*1.2,color(e.seed,2));ellipse(g,0,0,r*.25,r*1.2,color(e.seed,4));
        line(g,-r*.4,r*.95,-3,r*1.6,'#867458',.65);line(g,r*.4,r*.95,3,r*1.6,'#867458',.65);g.fillStyle='#897659';g.fillRect(-3,r*1.5,6,4);g.restore();return;
      }
      if(paintGuest(e,x,f,clock))return;
      if(e.type==='abduction'){
        const vertical=typeof fy==='number'?fy:f;
        const targetX=W*(.18+e.lane*.62),ground=middle(targetX)+25;
        const enter=S.smooth(0,.22,f),leave=S.smooth(.78,1,f);
        const from=e.reverse?W+80:-80,to=e.reverse?-150:W+150;
        const ux=S.lerp(from,targetX,enter)+leave*(to-targetX),uy=hy*.6+Math.sin(t)*2;
        // Let the beam grow and fade while the cow remains a continuous visitor,
        // rather than making the animal pop in and out with the beam's lifetime.
        g.save();g.globalAlpha=S.smooth(.22,.3,f)*(1-S.smooth(.7,.78,f));
        const beam=g.createLinearGradient(ux,uy,ux,ground);beam.addColorStop(0,'rgba(198,242,188,.3)');beam.addColorStop(1,'rgba(198,242,188,0)');g.fillStyle=beam;g.beginPath();g.moveTo(ux-7,uy);g.lineTo(ux-28,ground);g.lineTo(ux+28,ground);g.lineTo(ux+7,uy);g.closePath();g.fill();g.restore();
        const lift=Math.sin(S.clamp((vertical-.25)/.5)*Math.PI),cowY=S.lerp(ground,uy+14,lift);
        // Keep the returned cow on its ground anchor as the craft departs.
        g.save();g.globalAlpha=S.smooth(0,.08,f)*(1-S.smooth(.9,1,f));
        ellipse(g,targetX,cowY,5,3,'#eee8cd');ellipse(g,targetX+5,cowY-1,2.3,2,'#eee8cd');ellipse(g,targetX-2,cowY-1,2,1.6,'#46584f');line(g,targetX-3,cowY+2,targetX-3,cowY+5,'#eee8cd',1);line(g,targetX+3,cowY+2,targetX+3,cowY+5,'#eee8cd',1);g.restore();
        ellipse(g,ux,uy-3,8,5,'#96bcb1');ellipse(g,ux,uy,18,4,'#c7d5bd');for(let j=-10;j<=10;j+=5)ellipse(g,ux+j,uy+1,1,1,'#f2e5aa');
      }

  }
  function person(x,y,seed,motion){
    const shirt=color(seed),skin=skinColor(seed);
    const arm=hand=>{const elbowX=x+(motion.hipX+hand.x)*.5;line(g,x+motion.hipX,y-8+motion.bob,elbowX,y-5.5+motion.bob,skin,1.3);line(g,elbowX,y-5.5+motion.bob,x+hand.x,y+hand.y,skin,1.3);};
    arm(motion.arms[1]);
    personHead(g,x+motion.hipX,y-12+motion.bob,2,2,seed,skin);line(g,x+motion.hipX,y-9+motion.bob,x+motion.hipX,y+motion.hipY,shirt,3);
    for(const leg of motion.legs){
      line(g,x+motion.hipX,y+motion.hipY,x+leg.kneeX,y+leg.kneeY,'#647779',1.4);
      line(g,x+leg.kneeX,y+leg.kneeY,x+leg.footX,y+leg.footY,'#647779',1.4);
    }
    arm({x:motion.hand.x,y:motion.hand.y});
    return motion.hand;
  }
  function seated(x,y,seed,direction,book){
    const skin=skinColor(seed);
    g.save();g.translate(x,y);g.scale(direction,1);
    line(g,-1,-5,0,-1,color(seed),3.5);personHead(g,-1,-8,1.9,2.1,seed,skin);
    line(g,0,-1,3,-2,'#647779',1.8);line(g,3,-2,6,0,'#647779',1.5);
    line(g,6,0,8,0,'#526b6c',1.3);line(g,0,-5,3,-3,skin,1.2);
    if(book){
      // This reader is in profile: show an upright cover and a thin page edge,
      // not a face-on spread lying flat across their lap.
      g.fillStyle=color(seed,2);g.beginPath();g.moveTo(3,-8);g.lineTo(6,-7);g.lineTo(5,-2);g.lineTo(2,-3);g.closePath();g.fill();
      line(g,3,-7.7,2.2,-3.3,'#fff0cf',.65);line(g,0,-5,3,-3,skin,1.2);
      ellipse(g,3,-3,.65,.65,skin);
    }
    g.restore();
  }
  function airplane(x,y,dir,seed,t=0,propeller=false){
    if(propeller){
      g.save();g.translate(x,y);g.scale(dir,1);
      // Stacked wings, braced struts, fixed wheels and a nose propeller make
      // the message towplane legible as a classic biplane at scenery scale.
      const hull=color(seed),wing=color(seed,1),shade=color(seed,2);
      ellipse(g,-2,0,15,2.4,hull);ellipse(g,10,0,4,2.7,shade);
      line(g,-18,-3,-13,-3,wing,1.6);line(g,-17,0,-18,-6,shade,1.4);
      line(g,-9,-6,8,-6,shade,3.1);line(g,-9,3,8,3,shade,3.1);
      line(g,-9,-6,8,-6,wing,.8);line(g,-9,3,8,3,wing,.8);
      line(g,-6,-5,-5,2,'#516972',1);line(g,5,-5,4,2,'#516972',1);
      ellipse(g,-1,-2.6,3,1.6,'#8faeb7');
      line(g,-4,-1,-9,-1,wing,.65);line(g,-9,1,5,1,shade,.65);
      line(g,0,2,0,5.4,'#516972',1);line(g,-2,5.4,2,5.4,'#516972',1);
      ellipse(g,-.7,6,1.25,1.3,'#394850');ellipse(g,.7,6,1.25,1.3,'#394850');
      line(g,13,0,15,0,'#6c7770',1);
      const blade=Math.cos(t*37)*5;
      line(g,15,-blade,15,blade,'#6c7770',.9);ellipse(g,15,0,.7,.7,'#6c7770');
      g.restore();return;
    }
    g.save();g.translate(x,y);g.scale(dir,1);g.fillStyle=color(seed);
    g.beginPath();g.moveTo(12,0);g.lineTo(-12,-2);g.lineTo(-17,-7);g.lineTo(-20,-7);g.lineTo(-17,3);g.lineTo(-4,3);g.lineTo(-9,10);g.lineTo(-4,10);g.lineTo(3,3);g.closePath();g.fill();line(g,0,0,-7,-10,color(seed,2),3);g.restore();
  }
  function paintGuest(e,x,f,t){

    const dir=e.reverse?-1:1,c=color(e.seed),anchor=W*(.1+e.lane*.8),ground=trail(anchor)+19;
    const fy=geometry.motionProgress(e,'y'),verticalClock=geometry.motionAge(e,'y');
    if(['reader','picnic','couple','kite'].includes(e.type)){
      const visit=geometry.visitPose(e,f),paired=e.type==='picnic'||e.type==='couple';
      const fade=S.smooth(0,.04,f),groundAt=x=>trail(x)+19;
      g.save();g.globalAlpha=fade;
      if(paired&&visit.pack<1){
        // The blanket folds inward while food is gathered, before anyone leaves.
        const half=20*(1-visit.pack),ax=visit.anchor,ay=groundAt(ax);
        g.beginPath();g.moveTo(ax-half,groundAt(ax-half)-2);g.lineTo(ax+half,groundAt(ax+half)-2);g.lineTo(ax+half,groundAt(ax+half)+6);g.lineTo(ax-half,groundAt(ax-half)+6);g.closePath();g.fillStyle=color(e.seed,2);g.fill();
        if(e.type==='picnic'){
          g.save();g.globalAlpha*=1-visit.pack;
          ellipse(g,ax,ay+2,3.2,1.5,'#fff4d8');ellipse(g,ax,ay+1.5,1.8,.9,'#dc9e7d');g.fillStyle='#c8a87c';g.fillRect(ax+4,ay-1,4,4);g.restore();
        }
      }
      const offsets=paired?[-11,11]:[0];let kiteHand;
      offsets.forEach((offset,i)=>{
        const px=visit.x+offset,py=groundAt(px)+1,seed=(e.seed+i*.3)%1,book=e.type==='reader'||e.type==='couple'&&i===1;
        if(e.type!=='kite'&&visit.stand<1){g.save();g.globalAlpha*=1-visit.stand;seated(px,py,seed,i?-1:1,book&&visit.pack<.8);g.restore();}
        if(e.type==='kite'||visit.stand>0){
          const carrying=e.type==='kite'?0:S.smooth(.4,.7,visit.pack);
          const motion=geometry.humanWalkPose(px,py,visit.distance,visit.direction,geometry.humanGround('trail',20),carrying,1,e.type==='kite'?visit.travel:{...visit.travel,runStyle:'carrying'});
          if(e.type==='kite')motion.hand={x:motion.hipX+5,y:-6+motion.bob};
          g.save();g.globalAlpha*=e.type==='kite'?1:visit.stand;g.translate(px,py);g.scale(visit.direction,1);const hand=person(0,0,seed,motion);
          if(e.type==='kite')kiteHand={x:px+visit.direction*hand.x,y:py+hand.y};
          if(visit.pack>.7&&e.type!=='kite'){
            // Once a reader stands, keep the cover down by the carrying hand
            // at the hip instead of drawing it over the torso.
            g.fillStyle=book?'#fff0cf':color(e.seed,2);g.fillRect(hand.x,hand.y,book?4:6,book?3:4);
          }
          g.restore();
        }
      });
      if(e.type==='kite'){
        const ax=visit.x,ay=groundAt(ax),reach=1-visit.pack;
        const kx=ax+visit.direction*5+visit.direction*(23+Math.sin(t*.3)*12)*reach,ky=ay-8+(-67+Math.sin(verticalClock*.5)*6)*reach;
        g.beginPath();g.moveTo(kiteHand.x,kiteHand.y);g.quadraticCurveTo(kiteHand.x+visit.direction*30*reach,kiteHand.y-19*reach,kx,ky);g.strokeStyle='#8c9585';g.lineWidth=.65;g.stroke();
        const size=1-.7*visit.pack;g.save();g.translate(kx,ky);g.scale(size,size);
        g.beginPath();g.moveTo(0,-12);g.lineTo(8,0);g.lineTo(0,10);g.lineTo(-8,0);g.closePath();g.fillStyle=c;g.fill();line(g,0,-12,0,10,color(e.seed,2));
        for(let i=0;i<4;i++)line(g,Math.sin(verticalClock+i)*3,10+i*4,Math.sin(verticalClock+i+1)*3,14+i*4,c,.7);g.restore();
      }g.restore();return true;
    }
    if(e.type==='skateboarder'||e.type==='rollerskater'){
      const pose=geometry.skater(x,e.reverse),skin=skinColor(e.seed),phase=t*(1.8+e.seed*.6),push=Math.max(0,Math.sin(phase));
      g.save();g.globalAlpha=S.smooth(0,.06,f)*(1-S.smooth(.94,1,f));
      g.translate(pose.x,pose.y);g.rotate(pose.angle);g.scale(pose.direction,1);
      const wheel=(wx)=>ellipse(g,wx,-.9,.9,.9,p.city);
      if(e.type==='skateboarder'){
        line(g,-6,-2.2,6,-2.2,color(e.seed,2),1.4);wheel(-4);wheel(4);
        line(g,0,-8,3,-3,p.city,1.4);line(g,0,-8,-3-push*4,-3+push*2,p.city,1.4);
      }else{
        for(const side of [-1,1]){const foot=side*(2+push*2);line(g,0,-8,foot,-2.5,p.city,1.4);line(g,foot-1.5,-2,foot+1.5,-2,color(e.seed,2),1.4);wheel(foot-1);wheel(foot+1);}
      }
      line(g,0,-8,2,-14,c,2.7);ellipse(g,3,-17,1.9,1.9,skin);
      ellipse(g,3,-18,2.2,1.2,color(e.seed,2));
      line(g,2,-13,6,-10,skin,1.2);line(g,1,-13,-4,-11-push,skin,1.2);
      g.restore();return true;
    }
    if(e.type==='walker'||e.type==='dogwalker'){
      const pose=geometry.groundPose('walker',e);g.save();g.globalAlpha=S.smooth(0,.06,f)*(1-S.smooth(.94,1,f));
      const skin=skinColor(e.seed),motion=geometry.humanWalkPose(pose.x,pose.y,pose.distance,dir,geometry.humanGround('trail',5),false,1,pose.travel);
      // The far arm passes behind the torso; both arms share the leg stride.
      const armAt=index=>{const arm=motion.arms[index],elbowX=pose.x+dir*(motion.hipX+arm.x)*.5,elbowY=pose.y-5.5+motion.bob;line(g,pose.x+dir*motion.hipX,pose.y-8+motion.bob,elbowX,elbowY,skin,1.3);line(g,elbowX,elbowY,pose.x+dir*arm.x,pose.y+arm.y,skin,1.3);};
      armAt(1);
      personHead(g,pose.x+dir*motion.hipX,pose.y-12+motion.bob,2,2,e.seed,skin);line(g,pose.x+dir*motion.hipX,pose.y-9+motion.bob,pose.x+dir*motion.hipX,pose.y+motion.hipY,c,3);
      for(const leg of motion.legs){line(g,pose.x+dir*motion.hipX,pose.y+motion.hipY,pose.x+dir*leg.kneeX,pose.y+leg.kneeY,'#647779',1.4);line(g,pose.x+dir*leg.kneeX,pose.y+leg.kneeY,pose.x+dir*leg.footX,pose.y+leg.footY,'#647779',1.4);}
      armAt(0);
      if(e.type==='dogwalker'){
        const dog=geometry.dogPose(pose.x,pose.distance,dir),fur=S.mixHex(color(e.seed,2),p.city,.4),hand=motion.hand;
        // A loose lead keeps the companion visibly paired with this owner.
        g.beginPath();g.moveTo(pose.x+dir*hand.x,pose.y+hand.y);g.quadraticCurveTo((pose.x+dog.x)/2,dog.y+1,dog.x-dir*2,dog.y-5);g.strokeStyle=fur;g.lineWidth=.55;g.stroke();
        for(const [hip,offset] of [[-3,0],[3,.5]]){
          const foot=geometry.strideFoot(dog.distance,6,offset),fx=dog.x+dir*(hip+foot.x);
          line(g,dog.x+dir*hip,dog.y-3,fx,geometry.groundAnchor('walker',fx)-foot.lift,fur,1);
        }
        g.save();g.translate(dog.x,dog.y);g.scale(dir,1);
        ellipse(g,0,-4,4.6,2.1,fur);ellipse(g,4,-6,2,2,fur);ellipse(g,5.8,-5.6,1.3,.8,fur);
        line(g,3,-7,2.5,-4.8,p.city,1.4);line(g,-4,-4,-6,-7+Math.sin(pose.distance)*.8,fur,1.2);g.restore();
      }
      g.restore();return true;
    }
    if(e.type==='dolphin'){
      const pose=geometry.dolphin(f,e.lane,e.reverse,fy),ink=S.mixHex(p.city,p.night>.4?p.sky[2]:p.front,.5);
      g.save();g.globalAlpha=S.smooth(0,.12,f)*(1-S.smooth(.8,1,f));
      // Ripples sit on the waterline; the short breach curves above it.
      for(let i=0;i<3;i++){
        const radius=3+i*3+f*5;g.beginPath();g.ellipse(pose.x-dir*i*3,pose.waterY+1,radius,Math.max(.4,radius*.13),0,0,TAU);
        g.strokeStyle=S.mixHex(p.sky[2],p.city,.25);g.lineWidth=.65;g.stroke();
      }
      const drawDolphin=()=>{
        g.save();g.translate(pose.x,pose.y);g.rotate((f-.5)*.7*dir);g.scale(dir*pose.scale,pose.scale);
        g.fillStyle=ink;g.beginPath();g.moveTo(-7,1);g.bezierCurveTo(-3,-4,3,-4,6,-1);g.lineTo(9,0);g.lineTo(5,1);g.quadraticCurveTo(0,3,-7,1);g.fill();
        g.beginPath();g.moveTo(-1,-2);g.lineTo(-2,-6);g.lineTo(2,-2);g.moveTo(-6,1);g.lineTo(-10,-2);g.lineTo(-9,3);g.closePath();g.fill();g.restore();
      };
      reflectWaterObject(pose.waterY,drawDolphin);drawDolphin();
      g.restore();return true;
    }
    if(e.type==='duck'){
      for(let i=0;i<(e.seed>.4?3:1);i++){
        const pose=geometry.duckPose(e,verticalClock,i);
        const drawDuck=()=>{
          g.save();g.translate(pose.x,pose.y);g.scale(dir*pose.scale,pose.scale);
          ellipse(g,0,0,4,2.2,S.mixHex('#d6c6a2',c,.25));ellipse(g,3,-3,1.8,1.8,S.mixHex('#668d78',c,.25));line(g,4,-3,6,-3,'#dcb779',1);
          if(pose.flying){line(g,-1,-1,-4,-2-pose.wing,c,1.6);line(g,-1,-1,2,-2+pose.wing,c,1.3);}
          g.restore();
        };
        reflectWaterObject(pose.waterY+2.3*pose.scale,drawDuck);
        if(!pose.flying)line(g,pose.x-7*pose.scale,pose.waterY+3*pose.scale,
          pose.x+7*pose.scale,pose.waterY+3*pose.scale,S.mixHex(p.sky[2],p.sky[0],.3),.7*pose.scale);
        drawDuck();
      }return true;
    }
    if(e.type==='fish'){
      const vertical=typeof fy==='number'?fy:f;
      const fishX=anchor+dir*f*25,waterY=geometry.waterTop+H*.035;
      // A short breach should emerge from and disappear into the water, not
      // appear at full opacity on the first frame and vanish on the last.
      const fade=S.smooth(0,.12,f)*(1-S.smooth(.85,1,f));
      const drawFish=()=>ellipse(g,fishX,waterY-Math.sin(vertical*Math.PI)*14,4.5,2.25,c);
      g.save();g.globalAlpha=fade;reflectWaterObject(waterY,drawFish);drawFish();
      g.globalAlpha=fade*(1-f);g.strokeStyle=p.sky[2];g.beginPath();g.ellipse(fishX,waterY+2,4+f*14,1+f*2,0,0,TAU);g.stroke();g.restore();return true;
    }
    if(e.type==='butterfly'){
      const yy=middle(x)+14+Math.sin(verticalClock*2+e.seed*TAU)*8,fold=geometry.wingFold(t,e.seed);
      for(const spread of [fold.left,fold.right]){
        g.save();g.translate(x,yy);g.scale(spread,1);
        g.beginPath();g.moveTo(0,0);g.bezierCurveTo(2,-4,6,-4,5,-1);g.bezierCurveTo(6,2,3,4,0,1);g.closePath();g.fillStyle=color(e.seed,spread<0?0:1);g.fill();g.restore();
      }
      line(g,x,yy-1.5,x,yy+2,'#667a65',.7);return true;
    }
    if(e.type==='rabbit'||e.type==='deer'){
      const deer=e.type==='deer',pose=geometry.groundPose(e.type,e),yy=pose.y;
      g.save();g.globalAlpha=S.smooth(0,.06,f)*(1-S.smooth(.94,1,f));
      // Feet plant in world coordinates during stance; their swing follows distance traveled.
      if(deer)for(const [hip,offset] of [[-4,0],[4,.5]]){
        const leg=geometry.deerLeg(pose,hip,offset);
        line(g,leg.hipX,leg.hipY,leg.footX,leg.footY,c,1.2);
      }
      g.translate(pose.x,yy-pose.hop);g.rotate(geometry.tangent(trail,pose.x));g.scale(dir,1);
      ellipse(g,0,deer?-10:-3,deer?7:4,deer?4:3,c);ellipse(g,deer?7:4,deer?-16:-6,deer?3:2,deer?3:2,c);
      if(!deer)for(const xx of [-2,2])line(g,xx,-2,xx+(pose.hop>0?-1:1),0,c,1.2);
      line(g,deer?6:3,deer?-18:-7,deer?5:2,deer?-23:-12,c,1.5);
      if(deer)line(g,5,-11,7,-17,c,3);else line(g,5,-7,6,-12,c,1.4);
      g.restore();return true;
    }
    if(e.type==='hangglider'){
      const y=hy*.4+e.lane*hy*.2+Math.sin(verticalClock*.2+e.seed*TAU)*9+geometry.verticalOffset(e,15);
      g.save();g.translate(x,y);g.rotate(Math.sin(verticalClock*.3+e.seed*TAU)*.06);g.scale(dir,1);
      g.beginPath();g.moveTo(0,-10);g.lineTo(-27,7);g.lineTo(0,2);g.lineTo(27,7);g.closePath();g.fillStyle=c;g.fill();
      g.beginPath();g.moveTo(0,-10);g.lineTo(0,2);g.lineTo(27,7);g.closePath();g.fillStyle=color(e.seed,2);g.fill();
      line(g,-10,3,0,15,'#687d7e',.7);line(g,10,3,0,15,'#687d7e',.7);line(g,0,2,0,11,'#687d7e',.8);
      personHead(g,1,12,2,2,e.seed,skinColor(e.seed));line(g,-1,14,-8,17,color(e.seed,4),3);g.restore();return true;
    }
    if(e.type==='airshow'){
      const y=hy*.25+geometry.verticalOffset(e,20);
      for(let i=0;i<3;i++){
        const xx=x-i*23*dir,yy=y+(i-1)*17,smoke=['#ec7181','#fffaf2','#639ed9'][i];
        g.save();g.globalAlpha=.85*(1-p.night*.45)*S.smooth(0,.1,f)*(1-S.smooth(.65,1,f));
        const tail=g.createLinearGradient(xx-dir*160,0,xx,0);tail.addColorStop(0,smoke+'00');tail.addColorStop(1,smoke);
        g.strokeStyle=tail;g.lineWidth=4;g.beginPath();g.moveTo(xx,yy);for(let k=1;k<25;k++)g.lineTo(xx-k*7*dir,yy+Math.sin(verticalClock*.5-k*.13)*k*.2);g.stroke();g.restore();airplane(xx,yy,dir,e.seed+i*.1);
      }return true;
    }
    if(e.type==='skywriter'){
      if(!e.skywriterWord)return true;
      const drawing=e.skywriterPath ||= LandscapeSkywriter.wordPath(e.skywriterWord);
      if(!drawing)return true;
      // Reduced motion presents the completed word. Normal motion follows every
      // ink stroke and pen-up transfer, then gives the finished word time to fade.
      const frame=LandscapeSkywriter.trace(drawing,reduced?1:Math.min(1,f/.65));
      const scale=Math.min(4,W*.72/drawing.width),left=(W-drawing.width*scale)/2,top=hy*(.16+e.lane*.16);
      const fade=reduced?1:1-S.smooth(.78,1,f),drift=reduced?0:Math.max(0,f-.65)*12;
      g.save();g.translate(left,top-drift);g.scale(scale,scale);
      g.globalAlpha=fade*.8;g.lineCap='round';g.lineJoin='round';g.strokeStyle=p.night>.5?'#dce5ed':'#fffaf2';g.lineWidth=1.05;
      g.beginPath();for(const [a,b] of frame.segments){g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);}g.stroke();g.restore();
      if(frame.complete&&fade>.3){
        // Reuse the visible sky-text observer so a word is only marked seen
        // after trusted interaction, once the complete lettering is readable.
        e.bannerText=e.skywriterWord;visibleBanners.push({event:e,x:W/2,y:top+4*scale-drift});
      }
      if(!reduced){
        const departure=Math.max(0,(f-.65)/.35),px=left+frame.x*scale+departure*(W+80),py=top+frame.y*scale-departure*hy*.2;
        g.save();g.translate(px,py);g.rotate(frame.complete?-.1:frame.angle);g.scale(.65,.65);airplane(0,0,1,e.seed,t,true);g.restore();
      }
      return true;
    }
    if(e.type==='banner'){
      const y=hy*.3+e.lane*hy*.18+geometry.verticalOffset(e,18);
      if(e.bannerText===undefined)e.bannerText=LandscapeMood.airplaneMessage(e.seed);
      if(!e.bannerText){airplane(x,y,dir,e.seed,t,true);return true;}
      const bannerPalette=LandscapeAppearance.bannerColors(p.night,c,p.city);
      const layout=geometry.bannerLayout(e.bannerText,x,y,dir,(text,size)=>{
        g.save();g.font=`${size}px sans-serif`;const width=g.measureText(text).width;g.restore();return width;
      });
      visibleBanners.push({event:e,x:layout.x,y:layout.y});
      airplane(x,y,dir,e.seed,t,true);line(g,layout.towStartX,layout.towStartY,layout.towEndX,layout.towEndY,bannerPalette.tow,.7);
      g.save();g.translate(layout.x,layout.y);g.rotate(Math.sin(verticalClock)*.025);g.fillStyle=bannerPalette.fabric;
      g.fillRect(-layout.width/2,-layout.height/2,layout.width,layout.height);
      g.fillStyle=bannerPalette.ink;g.font=`${layout.fontSize}px sans-serif`;g.textAlign='center';g.textBaseline='middle';
      layout.lines.forEach((lineText,index)=>g.fillText(lineText,0,(index-(layout.lines.length-1)/2)*layout.lineHeight));
      g.restore();return true;
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
    sky=S.skyAt(S.sceneDate(new Date(Math.floor(Date.now()/60000)*60000),sceneStorage,location),location);p=S.palette(sky.sun.altitude);
    if(globalThis.LandscapeMood){sceneSeason=LandscapeMood.season(sky.date,location).name;p=LandscapeMood.palette(p,sky.date,location);}
    document.documentElement.dataset.sceneSeason=sceneSeason;syncScene(Date.now());updateChrome();
    document.documentElement.style.setProperty('--scene-tint',p.tint);
    document.documentElement.dataset.scenePeriod=sky.period;
    const entry=LandscapeMood.messageEntry(sky.date,{...location,sunAltitude:sky.sun.altitude},T.random(sceneSeed,'hourly-text',Math.floor(+sky.date/3600000)));
    currentEntry=entry;
    status.textContent=entry.text+(entry.author==='Human'?' · Human written':'');
    paintBackground();syncScene(Date.now());paintLife(world.elapsed);
    if(timeDialog.open)refreshSolarTimes();
  }
  function resize(){
    cityLights.windows=[];
    W=host.clientWidth;H=host.clientHeight;geometry=LandscapeGeometry.create(W,H);hy=geometry.horizon;
    if(!rooftopParty)rooftopParty={active:null};
    if(!clocktowerVisit)clocktowerVisit={active:null};
    // Pixel budget prevents high-DPR phones from allocating desktop-size canvases.
    dpr=Math.min(window.devicePixelRatio||1,1.5,Math.sqrt(3000000/(W*H)));
    for(const canvas of [back,front,partyLayer]){canvas.width=Math.floor(W*dpr);canvas.height=Math.floor(H*dpr);canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);}
    refreshSky();
  }
  function tick(now){
    if(reduced||document.hidden){frame=0;return;}
    frame=requestAnimationFrame(tick);
    // Carry the deadline across display frames so a 60Hz screen paints at
    // about 30fps rather than rounding each interval into a slower cadence.
    if(now+.5<nextPaint)return;
    nextPaint+=1000/30;
    if(nextPaint<=now)nextPaint=now+1000/30;
    last=now;syncScene(Date.now());
    if(lastCitySlot!==sceneSnapshot.windowsSlot){lastCitySlot=sceneSnapshot.windowsSlot;paintBackground();}
    paintLife(world.elapsed);
  }
  function scenePose(e,firework=false){return reduced?{...e,age:firework===true?(e.type==='festival'?e.duration:Math.min(e.duration,60))*.5:e.duration*.5,...(firework===true?{fireworkDeckAge:e.duration*.5,fireworkActive:e.age<(e.type==='festival'?e.duration:60)}:{})}:e;}
  function syncScene(now){
    const location=globalThis.LivingLocation?.current();
    const key=JSON.stringify([sceneSeason,location,S.readSceneTime(sceneStorage),S.readSceneSeason(sceneStorage)]);
    if(key!==timelineKey){
      timelineKey=key;
      const lock=S.readSceneTime(sceneStorage),lockedSun=new Map();
      const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:location?.timezone||'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
      timeline=T.create({seed:sceneSeed,season:sceneSeason,location,sunAt:at=>{
        const date=new Date(at),day=lock?calendar.format(date):null;
        if(day&&lockedSun.has(day))return lockedSun.get(day);
        const sun=S.sunAt(S.sceneDate(date,sceneStorage,location),location);
        if(day)lockedSun.set(day,sun);return sun;
      }});
    }
    sceneSnapshot=timeline.at(now);
    // Keep only local reading/paint memoization on an event with the same ID.
    // These fields never influence another event's seed, time, or admission.
    const retained=new Map(world.events.map(e=>[e.id,e]));
    world.elapsed=sceneSnapshot.elapsed;
    world.events=sceneSnapshot.events.map(e=>{
      const previous=retained.get(e.id);
      for(const field of ['bannerText','textSeen','skywriterWord','skywriterPath'])if(previous?.[field]!==undefined)e[field]=previous[field];
      if(e.type==='skywriter'&&e.skywriterWord===undefined)e.skywriterWord=LandscapeMood.skywriterMessage(e.seed);
      return e;
    });
    woodland.events=sceneSnapshot.woodland;
    const selected=sceneSnapshot.party;
    const roof=selected&&rooftopRoofs.reduce((best,candidate)=>!best||Math.abs(candidate.x/W-selected.roofIndex/96)<Math.abs(best.x/W-selected.roofIndex/96)?candidate:best,null);
    rooftopParty.active=roof?{...selected,roofIndex:roof.index}:null;
    clocktowerVisit.active=sceneSnapshot.clocktower;
  }
  function advanceRooftopParty(dt){
    if(document.hidden||!geometry||!p)return;
    // Static scenery repaints on membership changes, including the complete
    // barge crossing, without turning reduced motion into continuous animation.
    const before=JSON.stringify([world.events.map(e=>[e.id,e.type==='festival'&&e.age<e.duration]),woodland.events.map(e=>e.id),rooftopParty.active?.roofIndex,clocktowerVisit.active,lastCitySlot]);
    syncScene(Date.now());
    if(lastCitySlot!==sceneSnapshot.windowsSlot){lastCitySlot=sceneSnapshot.windowsSlot;paintBackground();}
    const after=JSON.stringify([world.events.map(e=>[e.id,e.type==='festival'&&e.age<e.duration]),woodland.events.map(e=>e.id),rooftopParty.active?.roofIndex,clocktowerVisit.active,lastCitySlot]);
    if(reduced&&before!==after)paintLife(world.elapsed);
  }
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;last=0;nextPaint=0;clearTimeout(skyTimer);clearTimeout(resizeTimer);clearInterval(partyTimer);skyTimer=0;resizeTimer=0;partyTimer=0;}
  function scheduleSky(){
    clearTimeout(skyTimer);if(document.hidden)return;
    const now=Date.now(),weather=S.weatherAt(new Date(now),sceneSeason);
    // Even static devices change weather at the shared episode boundary, not
    // one minute after whenever each device happened to open the app.
    const delays=[60000-now%60000,...[weather.start,weather.end].filter(at=>at>now).map(at=>at-now)];
    skyTimer=setTimeout(()=>{refreshSky();scheduleSky();},Math.max(1,Math.min(...delays)));
  }
  function start(){
    stop();if(document.hidden)return;
    if(W!==window.innerWidth||H!==window.innerHeight)resize();else refreshSky();
    scheduleSky();if(!reduced)frame=requestAnimationFrame(tick);else partyTimer=setInterval(()=>advanceRooftopParty(1),1000);
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
  const timeDialog=document.getElementById('sceneTimeDialog'),timeInput=document.getElementById('sceneTimeInput'),timeStatus=document.getElementById('sceneTimeStatus'),seasonInput=document.getElementById('sceneSeasonInput');
  let timeReturnFocus=null;
  function sceneTimeInputValue(){
    const zone=globalThis.LivingLocation?.current()?.timezone||'America/New_York';
    return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(S.sceneDate(new Date(),sceneStorage,globalThis.LivingLocation?.current()));
  }
  function renderSceneTimeChoice(){
    const saved=S.readSceneTime(sceneStorage);
    for(const button of timeDialog.querySelectorAll('[data-scene-preset], [data-scene-time="live"], [data-scene-time="lock"]')){
      const active=button.dataset.scenePreset===saved || (button.dataset.sceneTime==='live' && saved===null)
        || (button.dataset.sceneTime==='lock' && !!saved && !button.dataset.scenePreset && !timeDialog.querySelector('[data-scene-preset="'+saved+'"]'));
      button.setAttribute('aria-pressed',String(active));
    }
    const settingsButton=document.querySelector('#modalRoot [data-act="scene-time-settings"]');
    if(settingsButton){settingsButton.classList.toggle('setting-set',!saved);settingsButton.classList.toggle('setting-unset',!!saved);}
    const settingsStatus=document.getElementById('settingsSceneTimeStatus');
    if(settingsStatus)settingsStatus.textContent=(saved?'A scene time is selected.':'Following live time.')+' Synced with your board when signed in.';
  }
  function refreshSolarTimes(){
    const location=globalThis.LivingLocation?.current();
    // Preview a selected season before saving it; all labels use the observer's
    // calendar and zone, even when this device is on the other side of Earth.
    const preview={getItem:()=>seasonInput.value||null};
    const solarDate=S.sceneSolarDate(new Date(),preview,location),schedule=S.solarSchedule(solarDate,location);
    const dateLabel=window.formatScannerCalendarDate?.(solarDate,schedule.timeZone)||schedule.dateLabel;
    document.getElementById('sceneSolarDate').textContent=dateLabel+' · '+schedule.timeZone;
    for(const entry of schedule.events){
      const button=timeDialog.querySelector('[data-scene-preset="'+entry.preset+'"]');
      button.replaceChildren();
      const label=document.createElement('strong'),time=document.createElement('span');
      label.textContent=entry.label;time.textContent=entry.time;button.append(label,time);
      button.setAttribute('aria-pressed',String(S.readSceneTime(sceneStorage)===entry.preset));
    }
    renderSceneTimeChoice();
    return schedule;
  }
  window.applySyncedSceneTime=(time,season)=>{
    // A board adoption mirrors the shared choice into the offline sky keys.
    // Memory also holds it when browser storage rejects writes. Repaint
    // without emitting a user edit back into cloud sync.
    sceneStorage.applySynced(time,season);
    renderSceneTimeChoice();
    if(timeDialog.open){seasonInput.value=season||'';refreshSolarTimes();}
    refreshSky();
  };
  seasonInput.addEventListener('change',refreshSolarTimes);
  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-act="scene-time-settings"], [data-scene-time], [data-scene-preset]');if(!control)return;
    if(control.dataset.act==='scene-time-settings'){
      seasonInput.value=S.readSceneSeason(sceneStorage)||'';timeReturnFocus=document.activeElement;const saved=S.readSceneTime(sceneStorage);timeInput.value=sceneTimeInputValue();
      timeStatus.textContent=saved?'Scene time locked to '+saved.replaceAll('-',' ')+'.':'Following live time.';refreshSolarTimes();timeDialog.showModal();timeInput.focus();return;
    }
    if(control.dataset.sceneTime==='close'){timeDialog.close();return;}
    const preset=control.dataset.scenePreset;
    const value=control.dataset.sceneTime==='live'?null:preset||timeInput.value;
    if(value!==null&&!control.dataset.scenePreset&&!timeInput.reportValidity())return;
    if(!S.saveSceneSeason(storage,control.dataset.sceneTime==='live'?null:seasonInput.value||null)||!S.saveSceneTime(storage,value)){timeStatus.textContent='Could not save this time on this device. Please try again.';return;}
    sceneStorage.recordDeviceChoice(value,control.dataset.sceneTime==='live'?null:seasonInput.value||null);
    timeInput.value=sceneTimeInputValue();
    if(control.dataset.sceneTime==='live')seasonInput.value='';
    timeStatus.textContent=value?'Scene time locked to '+value.replaceAll('-',' ')+'.':'Following live time.';
    const selected=refreshSolarTimes().events.find(entry=>entry.preset===value);
    if(selected&&!selected.at)timeStatus.textContent='No '+selected.label.toLowerCase()+' on the selected date. Following live time.';
    refreshSky();
    document.dispatchEvent(new CustomEvent('landscape-scene-time-change',{detail:{time:S.readSceneTime(sceneStorage),season:S.readSceneSeason(sceneStorage)}}));
  });
  timeDialog.addEventListener('close',()=>timeReturnFocus?.isConnected&&timeReturnFocus.focus());
  window.addEventListener('storage',event=>{if(event.key==='fvp:chain-scanner:scene-time'||event.key==='fvp:chain-scanner:scene-season'||event.key===null){sceneStorage.release(event.key);refreshSky();renderSceneTimeChoice();}});
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
    // Hidden tabs do no rendering. Returning reconstructs only the current
    // UTC scene; missed arrivals are never animated as a catch-up burst.
    if(document.hidden)stop();else start();
  });
  document.addEventListener('landscape-location-change',()=>{refreshSky();});
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',start);
  resize();updateMotion();if(preference===null)openMotion();
  // Spawn-rate loading can finish after scanner boot. Tell the board when
  // this renderer is ready to receive its synced time and season choice.
  document.dispatchEvent(new CustomEvent('landscape-scene-time-ready'));
  // The editable local file is precached for offline use. A failed first load
  // leaves hourly text blank and cannot interrupt animation startup.
  fetch('./HUMAN_WRITTEN_HOURLY_TAGS.md').then(response=>{
    if(!response.ok)throw new Error('Human text unavailable');
    return response.text();
  }).then(markdown=>{LandscapeMood.setHumanText(markdown);refreshSky();}).catch(()=>{});
})();
