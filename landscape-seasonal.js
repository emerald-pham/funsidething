/* Small, deterministic seasonal ambience.  The ordinary visitor scheduler and
   the weather renderer remain separate; this file only paints local debris and
   flowers so a redraw can never create or retire a visitor by accident. */
(function(root){
  'use strict';

  const SEASONS=['spring','summer','autumn','winter'];
  const MAX_PARTICLES=60;
  const LEAF_COLORS=['#9a4f2c','#b56830','#c17a32','#80502f'];
  const PETAL_COLORS=['#f3d6df','#f7e7d0','#e9c8dc','#fff0d2'];
  const POLLEN_COLOR='#e5c56d';
  const BLOOM_COLORS=['#f3d6df','#f7e7d0','#e9c8dc','#fff0d2'];
  const WIND_COLOR='#d5e8d3';

  const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const unit=(value, fallback=0)=>{
    const number=finite(value,fallback);
    return number-Math.floor(number);
  };
  const smooth=(edge0,edge1,value)=>{
    const span=edge1-edge0;
    if(!span)return value<edge0?0:1;
    const q=clamp((value-edge0)/span,0,1);
    return q*q*(3-2*q);
  };
  const noise=(index,salt)=>unit(Math.sin((index+1)*12.9898+(salt+1)*78.233)*43758.5453);
  const seasonName=season=>{
    const value=String(season||'').toLowerCase();
    return SEASONS.includes(value)?value:'summer';
  };
  const weatherInfo=weather=>{
    const value=weather&&typeof weather==='object'?weather:{};
    const status=String(value.status||'clear').toLowerCase();
    const storm=Boolean(value.storm)||status==='thunderstorm'||status==='snowstorm';
    const intensity=clamp(finite(value.intensity,storm?1:0),0,1);
    return {storm,intensity};
  };
  const frameTime=t=>finite(t,0);

  function groundAt(geometry,x,H){
    const fallback=H-5;
    const value=geometry&&typeof geometry.near==='function'?finite(geometry.near(x),fallback):fallback;
    return clamp(value,-8,H+12);
  }

  function treeInfo(tree,index,geometry,W,H){
    const source=tree&&typeof tree==='object'?tree:{};
    const x=finite(source.x,W*(.12+noise(index,41)*.76));
    const size=clamp(Math.abs(finite(source.size,24+noise(index,43)*30)),12,72);
    // The caller's y is the planted tree's base.  Terrain is only a fallback for
    // origins without a y; using near-hill terrain for every tree moves all
    // middle-band canopies into the foreground.
    const terrain=groundAt(geometry,x,H);
    const ground=Number.isFinite(Number(source.y))?Number(source.y):terrain;
    const canopyTop=ground-size*.98;
    return {x,size,ground,canopyTop,variant:finite(source.variant,1)};
  }

  function fallbackTrees(geometry,W,H){
    return Array.from({length:5},(_,index)=>treeInfo({
      x:W*(.09+index*.205),
      y:groundAt(geometry,W*(.09+index*.205),H),
      size:25+noise(index,49)*28,
    },index,geometry,W,H));
  }

  function usableTrees(trees,geometry,W,H){
    const source=Array.isArray(trees)&&trees.length?trees:fallbackTrees(geometry,W,H);
    return source.map((tree,index)=>treeInfo(tree,index,geometry,W,H));
  }

  function blossomList(geometry,W,H){
    const flowers=[];
    // Clusters follow the foreground contour, so the same deterministic set
    // remains grounded after a resize and spreads across the complete scene.
    for(let index=0;index<24;index++){
      const x=clamp(W*(.035+index*.041+noise(index,61)*.033),1,W-1);
      const ground=groundAt(geometry,x,H);
      const y=clamp(ground-1.5-noise(index,63)*5,0,H+10);
      flowers.push({x,y,size:1.2+noise(index,65)*1.25,alpha:.58+noise(index,67)*.3,
        color:BLOOM_COLORS[index%BLOOM_COLORS.length],kind:'blossom'});
    }
    return flowers;
  }

  function canopyBlossoms(trees,geometry,W,H){
    const flowers=[];
    const count=Math.min(8,trees.length);
    for(let selected=0;selected<count&&flowers.length<24;selected++){
      const index=count===1?0:Math.round(selected*(trees.length-1)/(count-1));
      const tree=trees[index];
      for(let branch=0;branch<3&&flowers.length<24;branch++){
        const x=clamp(tree.x+(noise(index*3+branch,71)-.5)*tree.size*.9,0,W);
        const y=clamp(tree.canopyTop+tree.size*(.22+noise(index*3+branch,73)*.44),0,H+10);
        flowers.push({x,y,size:1.15+noise(index*3+branch,75)*1.1,
          alpha:.52+noise(index*3+branch,77)*.32,color:BLOOM_COLORS[(index+branch)%BLOOM_COLORS.length],kind:'blossom'});
      }
    }
    return flowers;
  }

  function autumnParticles(t,trees,geometry,W,H,weather){
    const info=weatherInfo(weather),time=frameTime(t),out=[];
    const source=usableTrees(trees,geometry,W,H);
    const leavesPerTree=Math.max(1,Math.floor(MAX_PARTICLES/source.length));
    for(let index=0;index<source.length&&out.length<MAX_PARTICLES;index++){
      const tree=source[index];
      for(let leaf=0;leaf<leavesPerTree&&out.length<MAX_PARTICLES;leaf++){
        const id=index*leavesPerTree+leaf,phase=unit(time/15+noise(id,81)*.94);
        const startX=tree.x+(noise(id,83)-.5)*tree.size*.74;
        const startY=tree.canopyTop+tree.size*(.06+noise(id,85)*.34);
        const fallDistance=Math.max(16,tree.ground-startY+10);
        const y=clamp(startY+fallDistance*phase,-20,H+22);
        const gust=(info.storm?(8+18*info.intensity):0)*Math.sin(time*.7+id*1.7);
        const x=clamp(startX+Math.sin(time*.9+id*2.1)*tree.size*.2+gust*phase,-20,W+20);
        const fadeIn=smooth(0,.08,phase),fadeOut=1-smooth(.82,1,phase),fade=fadeIn*fadeOut;
        out.push({x,y,size:1.2+noise(id,87)*1.5,alpha:clamp(.9*fade,0,1),
          color:LEAF_COLORS[id%LEAF_COLORS.length],kind:'leaf',angle:time*.7+id});
      }
    }
    return out;
  }

  function springParticles(t,trees,geometry,W,H,weather){
    const info=weatherInfo(weather),time=frameTime(t),out=[];
    const source=blossomList(geometry,W,H).concat(canopyBlossoms(usableTrees(trees,geometry,W,H),geometry,W,H));
    const status=String(weather&&weather.status||'clear').toLowerCase();
    const slot=Math.floor(time/60),slotRoll=noise(slot,4);
    const rain=status==='rain';
    const active=info.storm||slotRoll<(rain?.65:.35);
    if(!active)return out;
    const slotStart=slot*60+8+noise(slot,109)*34;
    const duration=info.storm?60:rain?10+noise(slot,111)*4:8+noise(slot,111)*4;
    if(!info.storm&&(time<slotStart||time>slotStart+duration))return out;
    const gateFade=info.storm?1:
      smooth(0,1.2,time-slotStart)*(1-smooth(duration-1.2,duration,time-slotStart));
    const amount=rain?Math.min(source.length+10,MAX_PARTICLES-12):source.length;
    for(let index=0;index<source.length&&out.length<amount;index++){
      const flower=source[index],phase=unit(time/13+noise(index,91)*.9);
      const rise=phase*92;
      const gust=(info.storm?(22+44*info.intensity):rain?8:0)*Math.sin(time*.55+index*1.3);
      const x=clamp(flower.x+Math.sin(time*.8+index*1.9)*8+gust*phase,-20,W+20);
      const y=clamp(flower.y-rise+Math.sin(time*.48+index)*3,-20,H+22);
      const fadeIn=smooth(0,.08,phase),fadeOut=1-smooth(.82,1,phase),fade=fadeIn*fadeOut;
      out.push({x,y,size:1.05+noise(index,93)*1.55,alpha:clamp(.9*fade*gateFade,0,1),
        color:PETAL_COLORS[index%PETAL_COLORS.length],kind:'petal',angle:time*.5+index});
    }
    if(info.storm){
      for(let index=0;index<10&&out.length<MAX_PARTICLES;index++){
        const flower=source[index%source.length],phase=unit(time/9+noise(index,95));
        const gust=(12+28*info.intensity)*Math.sin(time*.7+index*1.8);
        const fadeIn=smooth(0,.1,phase),fadeOut=1-smooth(.8,1,phase),fade=fadeIn*fadeOut;
        out.push({x:clamp(flower.x+gust*phase+Math.sin(index+time)*5,-20,W+20),
          y:clamp(flower.y-phase*76,-20,H+22),size:1+noise(index,97)*1.2,
          alpha:clamp(.62*fade,0,1),color:POLLEN_COLOR,kind:'pollen',angle:time+index});
      }
    }
    return out.slice(0,MAX_PARTICLES);
  }

  function summerParticles(t,W,H,weather){
    const info=weatherInfo(weather),time=frameTime(t),out=[];
    const count=info.storm?12:8;
    for(let index=0;index<count;index++){
      const phase=unit(index/count+time*(info.storm?.018:.008));
      const x=clamp(phase*(W+42)-21,-22,W+22);
      const y=clamp(H*(.24+noise(index,101)*.48)+Math.sin(time*.25+index)*4,-20,H+22);
      const gust=info.storm?Math.sin(time*.7+index)*8:0;
      out.push({x:clamp(x+gust,-22,W+22),y,size:1.1+noise(index,103)*1.1,
        alpha:clamp(info.storm?.28:.18,.05,.6),color:WIND_COLOR,kind:'wind',
        x2:clamp(x+24+gust,-22,W+22),y2:y+Math.sin(index)*2});
    }
    return out;
  }

  function winterParticles(t,trees,geometry,W,H,weather){
    const info=weatherInfo(weather),time=frameTime(t),out=[];
    const source=usableTrees(trees,geometry,W,H);
    const slot=Math.floor(time/60);
    for(let index=0;index<source.length&&out.length<MAX_PARTICLES;index++){
      const tree=source[index],roll=noise(index+slot*17,113),chance=info.storm?.72:.22;
      if(roll>=chance)continue;
      const offset=8+noise(index+slot*17,115)*34;
      const duration=info.storm?12+noise(index+slot*17,117)*8:8+noise(index+slot*17,117)*4;
      const elapsed=time-(slot*60+offset);
      if(elapsed<0||elapsed>duration)continue;
      const phase=clamp(elapsed/duration,0,1),id=index+slot*source.length;
      const startX=tree.x+(noise(id,119)-.5)*tree.size*.62;
      const startY=tree.canopyTop+tree.size*(.02+noise(id,121)*.2);
      const drop=Math.max(10,tree.size*.56),gust=info.storm?(10+22*info.intensity)*Math.sin(time*.8+index):0;
      const fadeIn=smooth(0,.12,phase),fadeOut=1-smooth(.78,1,phase),fade=fadeIn*fadeOut;
      out.push({x:clamp(startX+gust*phase,-20,W+20),y:clamp(startY+drop*phase,-20,H+22),
        size:1.6+noise(id,123)*1.5,alpha:clamp(.85*fade,0,1),color:'#e8f0eb',kind:'snow-clump',angle:phase});
    }
    return out;
  }

  function particles(t,season,trees,geometry,W,H,weather){
    const width=Math.max(1,finite(W,1)),height=Math.max(1,finite(H,1));
    const name=seasonName(season);
    const rate=globalThis.LandscapeConfig?.spawnRate('ambience-'+name) ?? 1;
    if(!rate)return [];
    t*=rate;
    if(name==='autumn')return autumnParticles(t,trees,geometry,width,height,weather);
    if(name==='spring')return springParticles(t,trees,geometry,width,height,weather);
    if(name==='summer')return summerParticles(t,width,height,weather);
    return winterParticles(t,trees,geometry,width,height,weather);
  }

  function nightFactor(p){return .35+.65*(1-clamp(finite(p&&p.night,0),0,1));}

  function drawBlossom(g,flower,factor=1){
    g.save();g.globalAlpha=flower.alpha*factor;g.fillStyle=flower.color;
    g.beginPath();g.ellipse(flower.x,flower.y,flower.size,flower.size*.72,0,0,Math.PI*2);g.fill();
    g.restore();
  }

  function drawParticle(g,particle,factor=1){
    g.save();g.globalAlpha=particle.alpha*factor;g.fillStyle=particle.color;g.strokeStyle=particle.color;
    if(particle.kind==='wind'){
      g.lineWidth=particle.size*.7;g.beginPath();g.moveTo(particle.x,particle.y);
      if(typeof g.quadraticCurveTo==='function')g.quadraticCurveTo((particle.x+particle.x2)/2,particle.y-2,particle.x2,particle.y2);
      else g.lineTo(particle.x2,particle.y2);
      g.stroke();
    }else if(particle.kind==='pollen'){
      g.beginPath();g.arc(particle.x,particle.y,particle.size*.7,0,Math.PI*2);g.fill();
    }else if(particle.kind==='leaf'){
      g.beginPath();g.ellipse(particle.x,particle.y,particle.size*1.25,particle.size*.65,particle.angle||0,0,Math.PI*2);g.fill();
    }else{
      g.beginPath();g.ellipse(particle.x,particle.y,particle.size*1.3,particle.size*.62,particle.angle||0,0,Math.PI*2);g.fill();
    }
    g.restore();
  }

  function drawSnowcap(g,tree,factor){
    g.save();g.globalAlpha=.72*factor;g.fillStyle='#e8f0eb';
    if(tree.variant<.25){
      for(let k=0;k<3;k++){
        const tipY=tree.ground-tree.size*(1.2-k*.22);
        const baseY=tree.ground-tree.size*(.42-k*.18);
        const capDepth=tree.size*.16,fullDepth=Math.max(1,baseY-tipY),capHalf=tree.size*(.23+k*.055)*capDepth/fullDepth;
        g.beginPath();g.moveTo(tree.x,tipY);g.lineTo(tree.x-capHalf,tipY+capDepth);g.lineTo(tree.x+capHalf,tipY+capDepth);g.closePath();g.fill();
      }
    }else{
      g.beginPath();
      g.ellipse(tree.x,tree.ground-tree.size*1.12,tree.size*.18,Math.max(1,tree.size*.06),0,0,Math.PI*2);
      g.fill();
    }
    g.restore();
  }

  function paint(g,trees,geometry,W,H,t,season,p,reduced,weather){
    if(!g)return;
    const width=Math.max(1,finite(W,1)),height=Math.max(1,finite(H,1)),name=seasonName(season);
    const factor=nightFactor(p);
    if(name==='spring'){
      const staticFlowers=blossomList(geometry,width,height).concat(canopyBlossoms(usableTrees(trees,geometry,width,height),geometry,width,height));
      staticFlowers.forEach(flower=>drawBlossom(g,flower,factor));
    }else if(name==='winter'){
      usableTrees(trees,geometry,width,height).forEach(tree=>drawSnowcap(g,tree,factor));
    }
    if(reduced)return;
    const airborne=particles(t,name,trees,geometry,width,height,weather);
    airborne.forEach(particle=>drawParticle(g,particle,factor));
  }

  root.LandscapeSeasonal={paint,particles,blossoms:blossomList};
})(globalThis);
