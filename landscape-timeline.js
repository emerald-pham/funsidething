/* Scenery is a function of a seed and a UTC instant, never of a tab's history.
   Candidate reservations are deliberately local and conservative: a rejected
   arrival cannot change a later random draw or evict an already visible visitor.
   Nothing here reads or writes a board, preference, account, or device store. */
(function(root){
  'use strict';
  const S=root.LivingSky,C=root.LandscapeConfig;
  const DEFAULT_SEED='chain-scanner-scene-v1',DAY=86400,MAX_LIFE=300;
  const unit=value=>((value%1)+1)%1;
  function sample(seed,stream,slot=0,salt=0){
    let hash=2166136261;
    for(const character of `${seed}|${stream}|${slot}|${salt}`)hash=Math.imul(hash^character.charCodeAt(0),16777619);
    hash=Math.imul(hash^(hash>>>16),0x7feb352d);hash=Math.imul(hash^(hash>>>15),0x846ca68b);
    return ((hash^(hash>>>16))>>>0)/4294967296;
  }
  const normalizeSeed=seed=>typeof seed==='string'&&seed.length&&seed.length<=128?seed:DEFAULT_SEED;
  function random(seed,stream,slot=0){let counter=0;return ()=>sample(seed,stream,slot,counter++);}
  function terrainSample(n,seed=DEFAULT_SEED){
    // Keep the accepted skyline/trees for the existing initial seed.
    const offset=seed===DEFAULT_SEED?0:sample(seed,'terrain')*1000;
    return unit(Math.sin((n+offset)*127.1+311.7)*43758.5453);
  }
  function event(type,start,r,id){
    const range=C.nightShows.fireworks.duration;
    const base=type==='fireworks'?S.lerp(range[0],range[1],r()):C.rail[type]?.duration||C.eventDurations[type]||
      (type==='abduction'?24:type==='bird'?28:type==='balloon'?150:type==='plane'?95:48+r()*50);
    const speed=type==='abduction'||type==='fireworks'?1:S.startingSpeed(r());
    const lane=r(),seed=r(),reverse=r()>.5;
    return {id,type,start:Math.round(start*1000)/1000,duration:Math.round((type==='fireworks'?Math.min(base,60):base/speed)*1000)/1000,speed,lane,seed,reverse,
      ...(type==='fireworks'?{scheduleDuration:Math.round(base*1000)/1000}:{}),
      ...(['cyclist','flock'].includes(type)?{count:S.groupSize(type,seed)}:{})};
  }
  function create(options={}){
    const seed=normalizeSeed(options.seed),season=C.seasons[options.season]?options.season:'summer';
    const sunCache=new Map(),showCache=new Map();let cachedBucket=null,cached=null;
    const sunAt=seconds=>{
      const minute=Math.floor(seconds/60);
      if(!sunCache.has(minute)){
        const date=new Date(minute*60000);
        sunCache.set(minute,options.sunAt?options.sunAt(+date):S.sunAt(date,options.location));
        if(sunCache.size>8192)sunCache.delete(sunCache.keys().next().value);
      }
      return sunCache.get(minute);
    };
    const terrain=n=>terrainSample(n,seed),city=root.LandscapeGeometry.create(1440,900).cityscape(terrain);
    const roofs=city.partyRoofs,gardens=[...city.gardens,...city.patios].map(roof=>roof.index).sort((a,b)=>a-b);
    const wind=.6+sample(seed,'wind')*1.2,visitSeed=sample(seed,'visitors');
    function ordinary(from,to){
      const out=[];
      for(let slot=Math.floor(from/8);slot<=Math.ceil(to/8);slot++){
        const r=random(seed,'arrival',slot),start=slot*8+r()*4,sky=sunAt(start),night=sky.altitude<-6;
        if(start<from||start>to||r()>=(night?.12:sky.azimuth<180?1:.65))continue;
        const type=r()<.025*C.spawnRate('abduction')*(night?.5:1)?'abduction':C.pickEvent(season,night?'night':'day',r);
        if(!type||C.rail[type]||!C.spawnRate(type))continue;
        if(type==='dolphin'&&r()>.35)continue;
        out.push(event(type,start,r,`arrival:${slot}`));
      }
      return out;
    }
    function festivals(from,to){
      const out=[],show=C.nightShows.festival;
      for(let slot=Math.floor(from/show.interval);slot<=Math.ceil(to/show.interval);slot++){
        const start=slot*show.interval,r=random(seed,'festival',slot);
        if(start<from||start>to||sunAt(start).altitude>=8||r()>=Math.min(1,show.chance*C.spawnRate('festival')))continue;
        out.push(event('festival',start,r,`festival:${slot}`));
      }
      return out;
    }
    function fireworks(day){
      if(showCache.has(day))return showCache.get(day);
      const out=[],show=C.nightShows.fireworks,scale=show.occurrenceScale||1,r=random(seed,'fireworks',day);
      // Each UTC day's immutable proposal plan samples the existing spacing duration
      // and configured start interval. Previous-day reservations bridge midnight.
      let start=day*DAY+20*scale;
      while(start<(day+1)*DAY){
        const roll=r();
        if(sunAt(start).altitude<8&&roll<Math.min(1,show.chance*C.spawnRate('fireworks'))){
          const candidate=event('fireworks',start,r,`fireworks:${day}:${out.length}`);out.push(candidate);
          start+=(candidate.scheduleDuration+show.rest)*scale;
        }else start+=show.interval*scale;
      }
      showCache.set(day,out);if(showCache.size>3)showCache.delete(showCache.keys().next().value);
      return out;
    }
    // Admission reservations keep the old show horizon; a shorter display must
    // not increase occurrence frequency or admit a different shared scene.
    const reservationDuration=e=>e.scheduleDuration||e.duration;
    const overlaps=(a,b)=>a.start<b.start+reservationDuration(b)&&b.start<a.start+reservationDuration(a);
    function build(bucket){
      const from=bucket*8,to=from+8;
      // At most five minutes of ordinary lifetimes and thirty minutes of rare
      // reservations influence an admission. This bound does not grow with age
      // of the app, offline time, or the number of previously rendered frames.
      const raw=ordinary(from-MAX_LIFE*2,to+MAX_LIFE);
      const rareRaw=[...ordinary(from-MAX_LIFE-1800,to+MAX_LIFE).filter(e=>e.type==='abduction'),
        ...festivals(from-MAX_LIFE-1800,to+MAX_LIFE)].sort((a,b)=>a.start-b.start);
      const rare=rareRaw.filter(e=>!rareRaw.some(prior=>prior.start<e.start&&
        e.start-prior.start<(e.type==='festival'&&prior.type==='festival'?C.nightShows.festival.cooldown:S.RARE_COOLDOWN)));
      const barges=rare.filter(e=>e.type==='festival');
      const day=Math.floor(from/DAY),proposals=[...fireworks(day-1),...fireworks(day)].sort((a,b)=>a.start-b.start);
      const shows=proposals.filter((e,index)=>e.start<to&&e.start+reservationDuration(e)>from&&
        (!index||e.start>=proposals[index-1].start+(C.nightShows.fireworks.occurrenceScale||1)*(proposals[index-1].scheduleDuration+C.nightShows.fireworks.rest))&&
        !barges.some(barge=>overlaps(e,barge)));
      const pool=[...raw.filter(e=>e.type!=='abduction'),...rare,...shows].sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
      const events=pool.filter(e=>{
        if(e.start>=to||e.start+reservationDuration(e)<=from)return false;
        const prior=pool.filter(other=>(other.start<e.start||other.start===e.start&&other.id<e.id)&&other.start+reservationDuration(other)>e.start);
        if(prior.length>=S.MAX_EVENTS-2)return false;
        if(['banner','skywriter','meteor','bird','dolphin'].includes(e.type)&&prior.some(other=>other.type===e.type))return false;
        return !C.waterEvents.includes(e.type)||prior.filter(other=>C.waterEvents.includes(other.type)).length<2;
      });
      for(const type of ['train','metro']){
        const rate=C.spawnRate(type);if(!rate)continue;
        const period=C.rail[type].duration/.82+C.rail[type].gap/rate;
        for(let slot=Math.floor((from-MAX_LIFE)/period);slot<=Math.ceil(to/period);slot++){
          const candidate=event(type,slot*period,random(seed,type,slot),`${type}:${slot}`);
          if(candidate.start<to&&candidate.start+candidate.duration>from)events.push(candidate);
        }
      }
      const woods=[],weights=C.woodland.types.map(type=>C.spawnRate('woodland-'+type)),total=weights.reduce((a,b)=>a+b,0);
      for(let slot=Math.floor((from-MAX_LIFE*2)/C.woodland.interval);slot<=Math.ceil(to/C.woodland.interval);slot++){
        const start=slot*C.woodland.interval,r=random(seed,'woodland',slot);
        if(!total||r()>=C.woodland.chance*total/weights.length)continue;
        let cursor=r()*total,index=0;while(index<weights.length-1&&cursor>=weights[index])cursor-=weights[index++];
        const speed=S.startingSpeed(r());woods.push({id:`woodland:${slot}`,type:C.woodland.types[index],start,duration:C.woodland.duration/speed,speed,seed:r(),lane:r(),reverse:r()>.5});
      }
      const woodland=woods.filter(e=>e.start<to&&e.start+reservationDuration(e)>from&&woods.filter(prior=>prior.start<e.start&&prior.start+prior.duration>e.start).length<C.woodland.maxActive);
      return {events,woodland};
    }
    function rareVisit(seconds,stream,interval,duration,chance,rate=1){
      const slot=Math.floor(seconds/interval),start=slot*interval,r=random(seed,stream,slot);
      if(seconds-start>=duration||sunAt(start).altitude>=(stream==='clocktower'?0:-6)||r()>=Math.min(1,chance*rate))return null;
      // A selected visit gets its complete lifetime followed by a fresh rest.
      const prior=random(seed,stream,slot-1);
      if(sunAt(start-interval).altitude<(stream==='clocktower'?0:-6)&&prior()<Math.min(1,chance*rate))return null;
      const value=r();
      return stream==='party'?{age:seconds-start,duration,roofIndex:roofs[Math.floor(value*roofs.length)]?.index??null}:
        {age:seconds-start,duration,seed:value,direction:value<.5?1:-1};
    }
    let gardenSlot=null,gardenSamples={};
    function lightsAt(seconds){
      const slot=Math.floor(seconds/60);
      if(slot===gardenSlot)return {...gardenSamples};
      gardenSlot=slot;gardenSamples={};const pending=new Set(gardens);
      // A bounded backwards search finds the latest independent roof sample;
      // it does not advance a mutable RNG or depend on viewport eligibility.
      for(let opportunity=slot;opportunity>slot-4096&&pending.size;opportunity--){
        if(sunAt(opportunity*60).altitude>=-6)continue;
        const index=gardens[Math.floor(sample(seed,'garden-roof',opportunity)*gardens.length)];
        if(pending.delete(index))gardenSamples[index]=sample(seed,'garden-light',opportunity)<1/6;
      }
      for(const index of pending)gardenSamples[index]=sample(seed,'garden-initial',index)<1/6;
      return {...gardenSamples};
    }
    return {
      at(instant){
        const milliseconds=instant instanceof Date?+instant:instant;
        if(!Number.isFinite(milliseconds))throw new TypeError('Valid UTC instant required');
        const seconds=milliseconds/1000,bucket=Math.floor(seconds/8);
        if(bucket!==cachedBucket){cachedBucket=bucket;cached=build(bucket);}
        const alive=list=>list.filter(e=>Math.round(e.start*1000)<=milliseconds&&Math.round(e.start*1000)+e.duration*1000>milliseconds)
          .map(({start,...e})=>({...e,age:(milliseconds-Math.round(start*1000))/1000}));
        const currentSun=sunAt(seconds),night=currentSun.altitude<-6;
        return {seed,elapsed:seconds,wind,visitSeed,events:alive(cached.events),woodland:alive(cached.woodland),
          clouds:Array.from({length:7},(_,index)=>({index,x:unit(terrain(index+71)+seconds*wind*(1.2+terrain(index+2)*1.5)/1440/1.2)*1.2-.1,
            y:terrain(index+82)*.68,size:terrain(index+101),opacity:.22+terrain(index+54)*.18})),
          party:night&&roofs.length?rareVisit(seconds,'party',30,24,.02):null,
          clocktower:currentSun.altitude<0?rareVisit(seconds,'clocktower',60,50,.02,C.spawnRate('clocktower-visit')):null,
          gardens:lightsAt(seconds),windowsSlot:Math.floor(seconds/7.5)};
      }
    };
  }
  // A window's round-robin phase is keyed in normalized tower/window space.
  // It changes independently of the number of pixels/windows a device paints.
  function windowLit(seed,index,slot){
    const initial=sample(seed,'window',index)>.42,phase=Math.floor(sample(seed,'window-phase',index)*1024);
    return !!(Number(initial)^(Math.floor((slot-phase)/1024)&1));
  }
  root.LandscapeTimeline={create,DEFAULT_SEED,sample,random,terrainSample,windowLit};
})(globalThis);
