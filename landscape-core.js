/* Offline sky and bounded event scheduling. No scanner state, DOM or network.
   Florida is an explicit observer, not an inference from the device timezone. */
(function(root){
  'use strict';
  const A=root.Astronomy, CONFIG=root.LandscapeConfig, RAD=Math.PI/180;
  if(!CONFIG)throw new Error('LandscapeConfig must load before landscape-core.js');
  const DEFAULT_LOCATION={latitude:28.5383,longitude:-81.3792,timezone:'America/New_York'};
  const observer=new A.Observer(DEFAULT_LOCATION.latitude,DEFAULT_LOCATION.longitude,20);
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
  function validDate(date){if(!(date instanceof Date)||!Number.isFinite(+date))throw new TypeError('Valid date required');}
  function locationObserver(location){
    if(location===undefined||location===null)return {observer,timeZone:DEFAULT_LOCATION.timezone};
    if(typeof location!=='object')throw new TypeError('Location object required');
    const latitude=location.latitude,longitude=location.longitude;
    if(typeof latitude!=='number'||!Number.isFinite(latitude)||latitude<-90||latitude>90)throw new RangeError('Invalid latitude');
    if(typeof longitude!=='number'||!Number.isFinite(longitude)||longitude<-180||longitude>180)throw new RangeError('Invalid longitude');
    const timeZone=location.timezone===undefined?DEFAULT_LOCATION.timezone:location.timezone;
    if(typeof timeZone!=='string'||!timeZone.trim())throw new RangeError('Invalid timezone');
    try{new Intl.DateTimeFormat('en-US',{timeZone}).format();}catch{throw new RangeError('Invalid timezone');}
    return {observer:new A.Observer(latitude,longitude,Number.isFinite(location.elevation)?location.elevation:20),timeZone};
  }
  function partsInZone(date,timeZone){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
    return Object.fromEntries(parts.map(p=>[p.type,p.value]));
  }
  function dateInZone(year,month,day,timeZone,hour=0){
    let guess=Date.UTC(year,month-1,day,hour);
    // Resolve the zone offset at the candidate midnight. Two passes cover the
    // DST transition without depending on a host-specific date parser.
    for(let i=0;i<3;i++){
      const at=partsInZone(new Date(guess),timeZone);
      const asUTC=Date.UTC(+at.year,+at.month-1,+at.day,+at.hour,+at.minute,+at.second);
      guess=Date.UTC(year,month-1,day,hour)-(asUTC-guess);
    }
    return new Date(guess);
  }
  function localMidnight(date,timeZone){
    const values=partsInZone(date,timeZone);
    return dateInZone(+values.year,+values.month,+values.day,timeZone);
  }
  function sameLocalDay(date,reference,timeZone){
    const a=partsInZone(date,timeZone),b=partsInZone(reference,timeZone);
    return a.year===b.year&&a.month===b.month&&a.day===b.day;
  }
  function bodyAt(body,date,obs){
    const eq=A.Equator(body,date,obs,true,true);
    const h=A.Horizon(date,obs,eq.ra,eq.dec,'normal');
    return {altitude:h.altitude,azimuth:h.azimuth,visible:h.altitude>-.3};
  }
  function sunTimes(date,location){
    validDate(date);
    const config=locationObserver(location),start=localMidnight(date,config.timeZone);
    const search=(direction)=>{try{
      const found=A.SearchRiseSet('Sun',config.observer,direction,start,2);
      return found&&found.date&&sameLocalDay(found.date,date,config.timeZone)?found.date:null;
    }catch{return null;}};
    return {rise:search(1),set:search(-1)};
  }
  function projectStar(date,row,rotation,obs){
    const ra=row[0]*15*RAD,dec=row[1]*RAD;
    const v=new A.Vector(Math.cos(dec)*Math.cos(ra),Math.cos(dec)*Math.sin(ra),Math.sin(dec),date);
    const eq=A.EquatorFromVector(A.RotateVector(rotation||A.Rotation_EQJ_EQD(date),v));
    const h=A.Horizon(date,obs,eq.ra,eq.dec,'normal');
    return {azimuth:h.azimuth,altitude:h.altitude,magnitude:row[2],colorIndex:row[3]||0};
  }
  function starAt(date,row,rotation,location){
    // Keep the original (date, row, rotation) call shape while accepting a
    // location as the convenient third argument for direct callers.
    if(location===undefined&&rotation&&typeof rotation==='object'&&!Array.isArray(rotation)&&!Array.isArray(rotation.rot)){location=rotation;rotation=undefined;}
    validDate(date); return projectStar(date,row,rotation,locationObserver(location).observer);
  }
  const polarDayCache=new Map();
  function skyAt(date,location){
    validDate(date);
    const config=locationObserver(location),sun=bodyAt('Sun',date,config.observer),moon=bodyAt('Moon',date,config.observer),phase=A.MoonPhase(date);
    let polarDay=false;
    if(Math.abs(config.observer.latitude)>66&&sun.visible){
      const parts=partsInZone(date,config.timeZone),key=[config.observer.latitude,config.observer.longitude,config.timeZone,parts.year,parts.month,parts.day].join(':');
      if(!polarDayCache.has(key)){const times=sunTimes(date,location);polarDayCache.set(key,!times.rise&&!times.set);if(polarDayCache.size>8)polarDayCache.delete(polarDayCache.keys().next().value);}
      polarDay=polarDayCache.get(key);
    }
    const rotation=A.Rotation_EQJ_EQD(date);
    const delta=(sun.azimuth-moon.azimuth)*RAD,sa=sun.altitude*RAD,ma=moon.altitude*RAD;
    // Project sunlight onto the Moon's local sky tangent plane. This follows
    // horizon tilt and hemisphere rather than always lighting a vertical side.
    moon.brightLimbAngle=Math.atan2(-(Math.sin(sa)*Math.cos(ma)-Math.cos(sa)*Math.sin(ma)*Math.cos(delta)),Math.cos(sa)*Math.sin(delta));
    return {date,sun,moon,phase,polarDay,illumination:A.Illumination('Moon',date).phase_fraction,
      period:polarDay?'day':sun.altitude < -12?'night':sun.altitude<8?(sun.azimuth<180?'dawn':'dusk'):'day',
      stars:root.SKY_STARS.map(row=>projectStar(date,row,rotation,config.observer)).filter(s=>s.altitude>0)};
  }
  // Shared anchor stops keep every sky and terrain layer continuous across twilight.
  const STOPS=[
    [-18,['#152b4a','#365779','#6b8ba5','#526b87','#5b8990','#497d7c','#39666b','#a7c7da']],
    [-9, ['#4e6287','#b2a4c3','#f3bdd0','#91a0b4','#88aaa5','#68998e','#527f79','#e6bfd5']],
    [-1, ['#91bedc','#f8c8bb','#fff0cd','#bfc3d1','#bcd5b1','#a3c98d','#7bb28a','#f3c59e']],
    [7,  ['#9bd4ef','#dbf4ee','#fff5d7','#bdd8dc','#c4e2b3','#aad88f','#8bc89a','#c5e7c5']],
    [35, ['#8ed4f3','#d4f5f2','#f6fbe2','#bbdce1','#c5e8b7','#ace097','#8dcca1','#ade1c6']]
  ];
  function mixHex(a,b,t){
    const rgb=h=>h.slice(1).match(/../g).map(n=>parseInt(n,16));
    return '#'+rgb(a).map((n,i)=>Math.round(lerp(n,rgb(b)[i],t)).toString(16).padStart(2,'0')).join('');
  }
  function palette(altitude){
    let lo=STOPS[0],hi=STOPS[STOPS.length-1];
    for(let i=0;i<STOPS.length-1;i++)if(altitude<=STOPS[i+1][0]){lo=STOPS[i];hi=STOPS[i+1];break;}
    const t=smooth(lo[0],hi[0],altitude),c=lo[1].map((v,i)=>mixHex(v,hi[1][i],t));
    return {sky:c.slice(0,3),city:c[3],far:c[4],hill:c[5],front:c[6],tint:c[7],night:1-smooth(-12,0,altitude)};
  }
  const SKIN_TONES=['#4a2f28','#654132','#82563f','#9c6b4b','#b27d58','#c68f68','#d9a27e','#e6b795','#efc9ac','#f6dbc2'];
  function skinTone(seed,night=0,ambient='#526c80'){
    const value=Number.isFinite(seed)?clamp(seed,0,.999999):0;
    return mixHex(SKIN_TONES[Math.floor(value*SKIN_TONES.length)],ambient,clamp(night)*.18);
  }
  function advanceLights(state,elapsed,night,random=Math.random){
    if(elapsed<state.next)return false;
    state.next=elapsed+30;
    if(!night||!state.windows.length)return false;
    const index=Math.floor(clamp(random(),0,.999999)*state.windows.length);
    state.windows[index]=!state.windows[index];return true;
  }
  function activity(sky){return sky.sun.altitude < -6?.24:sky.sun.azimuth<180?1:.65;}
  const MAX_EVENTS=14,RARE_COOLDOWN=420;
  const EVENT_TYPES=CONFIG.eventTypes;
  const WINTER_VISITORS=CONFIG.winterEvents.filter(type=>!EVENT_TYPES.includes(type));
  const WINTER_EVENTS=CONFIG.seasons.winter.events;
  const eventsForSeason=season=>CONFIG.eventsForSeason(season);
  function setSeason(world,season){
    if(world.season===season)return;
    world.season=season;
    const allowed=new Set([...eventsForSeason(season),'meteor','abduction','fireworks']);
    // A season selection should not leave a summer picnic or watersport on snow.
    // Preserve the ordinary schedule rather than forcing a burst of replacements.
    world.events=world.events.filter(event=>allowed.has(event.type));
  }
  const RARE_TYPES=['abduction','fireworks'];
  const NIGHT_TYPES=CONFIG.nightEvents;
  const NIGHT_REGULARS=CONFIG.nightRegulars;
  const WATER_TYPES=CONFIG.waterEvents;
  const EVENT_DURATIONS=CONFIG.eventDurations||CONFIG.durations;
  const INITIAL_TYPES=EVENT_TYPES.filter(type=>type!=='dolphin');
  function createWorld(random=Math.random,season='summer'){
    const world={random,season,railNext:{train:0,metro:12},elapsed:0,events:[],next:3+random()*6,lastRare:-RARE_COOLDOWN,rareCount:0,wind:.6+random()*1.2};
    // Start mid-journey so returning never waits for a first event. Pick three
    // distinct ordinary visitors; the rare abduction is never in the opening cast.
    const pool=(season==='winter'?WINTER_EVENTS:INITIAL_TYPES).filter(type=>CONFIG.spawnRate(type)>0);
    while(world.events.length<3&&pool.length){
      let cursor=clamp(random(),0,1-.0000001)*pool.reduce((sum,type)=>sum+CONFIG.spawnRate(type),0),index=0;
      while(index<pool.length-1&&cursor>=CONFIG.spawnRate(pool[index]))cursor-=CONFIG.spawnRate(pool[index++]);
      spawn(world,pool.splice(index,1)[0],true);
    }
    return world;
  }
  function spawn(w,type,initial=false){
    if(!type||!CONFIG.spawnRate(type))return;
    if(CONFIG.rail[type]&&w.events.some(e=>e.type===type))return;
    if(['banner','skywriter','meteor','bird','dolphin'].includes(type)&&w.events.some(e=>e.type===type))return;
    if(WATER_TYPES.includes(type)&&w.events.filter(e=>WATER_TYPES.includes(e.type)).length>=2)return;
    const r=w.random;
    const skywriterWord=type==='skywriter'?root.LandscapeMood?.skywriterMessage(r):undefined;
    if(type==='skywriter'&&!skywriterWord)return;
    if(type==='dolphin'&&r()>.35)return; // A short, occasional surprise, never an opening attraction.
    const base=CONFIG.rail[type]?.duration||EVENT_DURATIONS[type]|| (type==='abduction'?24:type==='bird'?28:type==='balloon'?150:type==='plane'?95:48+r()*50);
    const duration=base*((type==='abduction'||type==='fireworks')?1:.8+r()*.4);
    w.events.push({type,...(skywriterWord?{skywriterWord}:{}),age:initial?duration*(.15+r()*.45):0,duration,lane:r(),seed:r(),reverse:r()>.5});
  }
  function advance(w,dt,sky){
    if(!Number.isFinite(dt)||dt<=0)return w;
    w.elapsed+=dt;
    w.events=w.events.filter(e=>{e.age+=dt;return e.age<e.duration;});
    // Reserve two of the existing slots for rail service. Each track has one
    // vehicle at most; after it clears, a short gap replaces random long waits.
    for(const type of ['train','metro']){
      const rate=CONFIG.spawnRate(type),active=w.events.find(e=>e.type===type);
      if(active){w.railNext[type]=w.elapsed+Math.max(0,active.duration-active.age)+CONFIG.rail[type].gap/(rate||1);continue;}
      if(rate&&w.elapsed>=w.railNext[type]&&w.events.length<MAX_EVENTS){
        spawn(w,type);w.railNext[type]=w.elapsed+CONFIG.rail[type].gap/rate;
      }
    }
    if(w.elapsed>=w.next){
      const r=w.random,a=activity(sky);
      w.next=w.elapsed+(7+r()*18)/a;
      if(w.events.length<MAX_EVENTS-2){
        const abduction=CONFIG.spawnRate('abduction'),fireworks=sky.sun.altitude < -6?CONFIG.spawnRate('fireworks'):0;
        const rareRate=sky.sun.altitude < -6?(abduction+fireworks)/2:abduction;
        if(w.elapsed-w.lastRare>=RARE_COOLDOWN && r()<.025*rareRate){
          const type=fireworks&&r()<fireworks/(abduction+fireworks)?'fireworks':'abduction';
          spawn(w,type);w.lastRare=w.elapsed;w.rareCount++;
        }else{
          let type;
          if(sky.sun.altitude < -6){
            // Night visitors share the editable weights; rail service is independent.
            type=CONFIG.pickEvent(w.season,'night',r);
          }else type=CONFIG.pickEvent(w.season,'day',r);
          if(!CONFIG.rail[type])spawn(w,type);
        }
      }
    }
    return w;
  }
  function weatherAt(now,season='summer'){
    validDate(now);
    // One immutable UTC episode schedule is shared by offline and online devices.
    // A selected winter scene changes the precipitation, never its timing.
    const weather=CONFIG.weather,slot=Math.floor(+now/weather.slot);
    const random=salt=>{let hash=(slot^0x51a7c3d9^Math.imul(salt,0x9e3779b9))|0;hash=Math.imul(hash^(hash>>>16),0x7feb352d);hash=Math.imul(hash^(hash>>>15),0x846ca68b);return ((hash^(hash>>>16))>>>0)/4294967296;};
    const storm=random(1)<weather.stormChance;
    const weatherType=season==='winter'?(storm?'snowstorm':'snow'):(storm?'thunderstorm':'rain');
    const enabled=random(0)<Math.min(1,weather.chance*CONFIG.spawnRate(weatherType));
    // NWS ordinary thunderstorm cells last about 30–60 minutes. Quieter
    // showers are shorter; three-hour slots leave room for a natural clearing.
    const start=Math.round(slot*weather.slot+(weather.startMinutes[0]+random(3)*(weather.startMinutes[1]-weather.startMinutes[0]))*60000);
    const durationRange=storm?weather.stormMinutes:weather.showerMinutes;
    const end=Math.round(start+(durationRange[0]+random(2)*(durationRange[1]-durationRange[0]))*60000);
    const active=enabled&&+now>=start&&+now<end;
    const status=!active?'clear':season==='winter'?(storm?'snowstorm':'snow'):(storm?'thunderstorm':'rain');
    return {status,intensity:active?smooth(start,start+120000,+now)*(1-smooth(end-120000,end,+now)):0,storm:active&&storm,slot,start,end};
  }
  const woodlandConfig=CONFIG.woodland,woodlandTypes=woodlandConfig.types;
  function createWoodland(random=Math.random){return {random,elapsed:0,next:woodlandConfig.interval,events:[]};}
  function advanceWoodland(w,dt){
    if(!Number.isFinite(dt)||dt<=0)return w;
    w.elapsed+=dt;
    w.events=w.events.filter(e=>{e.age+=dt;return e.age<e.duration;});
    if(w.elapsed>=w.next){
      // Its own RNG, budget and deadline leave every other visitor's odds alone.
      // Never replay missed rolls after a pause or a delayed frame.
      w.next=w.elapsed+woodlandConfig.interval;
      const weights=woodlandTypes.map(type=>CONFIG.spawnRate('woodland-'+type)),total=weights.reduce((a,b)=>a+b,0);
      if(total&&w.events.length<woodlandConfig.maxActive&&w.random()<woodlandConfig.chance*total/woodlandTypes.length){
        const r=w.random;let cursor=r()*total,index=0;while(index<weights.length-1&&cursor>=weights[index])cursor-=weights[index++];
        w.events.push({type:woodlandTypes[index],age:0,duration:woodlandConfig.duration,seed:r(),lane:r(),reverse:r()>.5});
      }
    }
    return w;
  }
  const SCENE_TIME_KEY='fvp:chain-scanner:scene-time';
  const validSceneTime=value=>['sunrise','sunset'].includes(value)||typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  function readSceneTime(storage){try{const value=storage.getItem(SCENE_TIME_KEY);return validSceneTime(value)?value:null;}catch{return null;}}
  function saveSceneTime(storage,value){
    if(value!==null&&!validSceneTime(value))return false;
    try{if(value===null)storage.removeItem(SCENE_TIME_KEY);else storage.setItem(SCENE_TIME_KEY,value);return true;}catch{return false;}
  }
  const SCENE_SEASON_KEY='fvp:chain-scanner:scene-season';
  const seasons=['spring','summer','autumn','winter'];
  function readSceneSeason(storage){try{const value=storage.getItem(SCENE_SEASON_KEY);return seasons.includes(value)?value:null;}catch{return null;}}
  function saveSceneSeason(storage,value){
    if(value!==null&&!seasons.includes(value))return false;
    try{if(value===null)storage.removeItem(SCENE_SEASON_KEY);else storage.setItem(SCENE_SEASON_KEY,value);return true;}catch{return false;}
  }
  function sceneSolarDate(now,storage,location){
    const season=readSceneSeason(storage);
    if(!season)return new Date(now);
    const zone=locationObserver(location).timeZone,month=([3,6,9,0][seasons.indexOf(season)]+(location?.latitude<0?6:0))%12;
    return dateInZone(+partsInZone(now,zone).year,month+1,15,zone,12);
  }
  function sceneDate(now,storage,location){
    const date=new Date(now),time=readSceneTime(storage);
    const season=readSceneSeason(storage);
    // Dates comfortably inside each season keep palette and daylight in agreement.
    // Use the observer's hemisphere, while preserving device-local clock selection.
    if(season)date.setMonth(([3,6,9,0][seasons.indexOf(season)]+(location?.latitude<0?6:0))%12,15);
    if(time==='sunrise'||time==='sunset'){
      return sunTimes(sceneSolarDate(now,storage,location),location)[time==='sunrise'?'rise':'set']||new Date(now);
    }
    if(time){const [hour,minute]=time.split(':').map(Number);date.setHours(hour,minute,0,0);}
    return date;
  }
  const MOTION_KEY='fvp:chain-scanner:landscape-motion';
  const normalizeMotion=v=>v==='normal'||v==='reduced'?v:null;
  function readMotion(storage){try{return normalizeMotion(storage.getItem(MOTION_KEY));}catch{return null;}}
  function saveMotion(storage,value){try{storage.setItem(MOTION_KEY,value);return true;}catch{return false;}}
  function motionReduced(value,osReduced){return !!osReduced||normalizeMotion(value)!=='normal';}
  root.LivingSky={setSeason,eventsForSeason,sceneSolarDate,weatherAt,createWoodland,advanceWoodland,woodlandTypes,readSceneSeason,saveSceneSeason,advanceLights,skinTone,sceneDate,readSceneTime,saveSceneTime,skyAt,sunTimes,starAt,starCount:root.SKY_STARS.length,palette,activity,createWorld,advance,
    nightEventTypes:NIGHT_TYPES.slice(),eventTypes:[...EVENT_TYPES,...WINTER_VISITORS],rareTypes:RARE_TYPES.slice(),eventDurations:Object.assign({},EVENT_DURATIONS),MAX_EVENTS,RARE_COOLDOWN,readMotion,saveMotion,motionReduced,clamp,lerp,smooth,mixHex};
})(globalThis);
