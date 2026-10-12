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
  function random(seed,stream,slot=0){
    let counter=0;
    // Each immutable opportunity draws several salts from the same prefix.
    // Preserve per-draw conversion for callers with mutable object inputs.
    if(typeof seed!=='string'||typeof stream!=='string'||!['number','string'].includes(typeof slot))return ()=>sample(seed,stream,slot,counter++);
    let prefix=2166136261;
    for(const character of `${seed}|${stream}|${slot}|`)prefix=Math.imul(prefix^character.charCodeAt(0),16777619);
    return ()=>{
      let hash=prefix;
      for(const character of `${counter++}`)hash=Math.imul(hash^character.charCodeAt(0),16777619);
      hash=Math.imul(hash^(hash>>>16),0x7feb352d);hash=Math.imul(hash^(hash>>>15),0x846ca68b);
      return ((hash^(hash>>>16))>>>0)/4294967296;
    };
  }
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
    // Keep logical lifetimes identical across browsers and resize. The shared
    // finite travel budget covers canvases through 8192 CSS pixels; smaller
    // canvases simply finish painting a visit earlier, without changing admission.
    const walkingGeometry=root.LandscapeGeometry.create(8192,900);
    const visibleDuration=e=>walkingGeometry.walkingLifetime(e);
    const extendWalk=(e,duration)=>duration===e.duration?e:{...e,activityDuration:e.duration,duration};
    const dayPlans=new Map();
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
      // Rejected local draws cannot create a show; skip their unused sun query.
      for(let slot=Math.floor(from/show.interval);slot<=Math.ceil(to/show.interval);slot++){
        const start=slot*show.interval,r=random(seed,'festival',slot);
        if(start<from||start>to||r()>=Math.min(1,show.chance*C.spawnRate('festival'))||!S.fireworksAllowed(sunAt(start)))continue;
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
        if(roll<Math.min(1,show.chance*C.spawnRate('fireworks'))&&S.fireworksAllowed(sunAt(start))){
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
    function dayPlan(day){
      const key=JSON.stringify([day,...C.spawnRateNames.map(C.spawnRate)]);
      if(dayPlans.has(key)){const plan=dayPlans.get(key);dayPlans.delete(key);dayPlans.set(key,plan);return plan;}
      const from=day*DAY,to=from+DAY;
      // A visit must finish its full reservation before the next UTC day. This
      // upfront admission guard gives cold clients a bounded, identical replay;
      // it never ends an underway visitor at midnight or stores tab history.
      const raw=ordinary(from-MAX_LIFE*2,to),rawRare=raw.filter(e=>e.type==='abduction'),rareIds=new Set(rawRare.map(e=>e.id));
      // The rare guard needs earlier draws, not a second copy of the same day.
      // Deduplicate the inclusive join by immutable ID, including rounded starts.
      const rareRaw=[...rawRare,...ordinary(from-MAX_LIFE*3-1800,from-MAX_LIFE*2).filter(e=>e.type==='abduction'&&!rareIds.has(e.id)),
        ...festivals(from-MAX_LIFE*3-1800,to)].sort((a,b)=>a.start-b.start);
      const rare=rareRaw.filter(e=>!rareRaw.some(prior=>prior.start<e.start&&
        e.start-prior.start<(e.type==='festival'&&prior.type==='festival'?C.nightShows.festival.cooldown:S.RARE_COOLDOWN)));
      const barges=rare.filter(e=>e.type==='festival'),proposals=[];
      for(let d=day-2;d<=day;d++)proposals.push(...fireworks(d));
      proposals.sort((a,b)=>a.start-b.start);
      const shows=proposals.filter((e,index)=>e.start<to&&e.start+reservationDuration(e)>from-MAX_LIFE*2&&
        (!index||e.start>=proposals[index-1].start+(C.nightShows.fireworks.occurrenceScale||1)*(proposals[index-1].scheduleDuration+C.nightShows.fireworks.rest))&&
        !barges.some(barge=>overlaps(e,barge)));
      const pool=[...raw.filter(e=>e.type!=='abduction'),...rare,...shows].sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
      const events=[];let prior=[],active=[];
      for(const e of pool){
        // The original type/chance rules still see every raw predecessor, even
        // one that was rejected. Keep a sliding original-reservation list.
        prior=prior.filter(other=>other.start+reservationDuration(other)>e.start);
        const eligible=prior.length<S.MAX_EVENTS-2&&
          (!['banner','skywriter','meteor','bird','dolphin'].includes(e.type)||!prior.some(other=>other.type===e.type))&&
          (!C.waterEvents.includes(e.type)||prior.filter(other=>C.waterEvents.includes(other.type)).length<2);
        prior.push(e);
        if(!eligible||e.start<from||e.start>=to)continue;
        // A full reservation budget rejects this proposal regardless of its
        // lifetime. Avoid solving its terrain route; original eligibility and
        // random draws above still see every raw proposal in the same order.
        active=active.filter(other=>other.end>e.start);
        if(active.length>=S.MAX_EVENTS-2)continue;
        const duration=visibleDuration(e),end=e.start+Math.max(duration,reservationDuration(e));
        if(end>to)continue;
        active.push({end});events.push(extendWalk(e,duration));
      }
      dayPlans.set(key,events);if(dayPlans.size>2)dayPlans.delete(dayPlans.keys().next().value);
      return events;
    }
    function build(bucket){
      const from=bucket*8,to=from+8;
      const events=dayPlan(Math.floor(from/DAY)).filter(e=>e.start<to&&e.start+e.duration>from);
      for(const type of ['train','metro']){
        const rate=C.spawnRate(type);if(!rate)continue;
        // Bernoulli opportunities are one maximum crossing apart, so no
        // accepted train can collide with its predecessor. Round the opportunity
        // interval upwards in the same millisecond domain as event lifetimes:
        // fractional spacing once overlapped two metros for one millisecond.
        // interval / chance
        // equals the former maximum crossing + rate-scaled rest: the mean
        // service frequency is retained, but missed slots have no deadline.
        const maximum=C.rail[type].duration/.82,interval=Math.ceil(maximum*1000)/1000;
        const period=maximum+C.rail[type].gap/rate,chance=interval/period;
        for(let slot=Math.floor((from-MAX_LIFE)/interval);slot<=Math.ceil(to/interval);slot++){
          if(sample(seed,`${type}-admission`,slot)>=chance)continue;
          const candidate=event(type,slot*interval,random(seed,type,slot),`${type}:${slot}`);
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
  // The former parity flips were half lit over the long run. Independent
  // half-lit samples differ half the time, so half the old 1024 half-length
  // ticks preserve the doubled mean toggle spacing and long-run occupancy.
  // Sampling the current slot is O(1), even after years offline; no history,
  // finite backwards search, or maximum-wait fallback can force a transition.
  function windowLit(seed,index,slot){
    const interval=512,phase=sample(seed,'window-phase',index)*interval;
    return sample(seed,`window:${index}`,Math.floor((slot-phase)/interval))>.5;
  }
  root.LandscapeTimeline={create,DEFAULT_SEED,sample,random,terrainSample,windowLit};
})(globalThis);
