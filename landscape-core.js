/* Offline sky and bounded event scheduling. No scanner state, DOM or network.
   Florida is an explicit observer, not an inference from the device timezone. */
(function(root){
  'use strict';
  const A=root.Astronomy, RAD=Math.PI/180;
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
  function localMidnight(date,timeZone){
    const values=partsInZone(date,timeZone),year=+values.year,month=+values.month,day=+values.day;
    let guess=Date.UTC(year,month-1,day);
    // Resolve the zone offset at the candidate midnight. Two passes cover the
    // DST transition without depending on a host-specific date parser.
    for(let i=0;i<3;i++){
      const at=partsInZone(new Date(guess),timeZone);
      const asUTC=Date.UTC(+at.year,+at.month-1,+at.day,+at.hour,+at.minute,+at.second);
      guess=Date.UTC(year,month-1,day)-(asUTC-guess);
    }
    return new Date(guess);
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
    if(location===undefined&&rotation&&typeof rotation==='object'&&!Array.isArray(rotation)){location=rotation;rotation=undefined;}
    validDate(date); return projectStar(date,row,rotation,locationObserver(location).observer);
  }
  function skyAt(date,location){
    validDate(date);
    const config=locationObserver(location),sun=bodyAt('Sun',date,config.observer),moon=bodyAt('Moon',date,config.observer),phase=A.MoonPhase(date);
    const rotation=A.Rotation_EQJ_EQD(date);
    return {date,sun,moon,phase,illumination:(1-Math.cos(phase*RAD))/2,
      period:sun.altitude < -12?'night':sun.altitude<8?(sun.azimuth<180?'dawn':'dusk'):'day',
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
  function activity(sky){return sky.sun.altitude < -6?.24:sky.sun.azimuth<180?1:.65;}
  const MAX_EVENTS=14,RARE_COOLDOWN=420;
  const EVENT_TYPES=['cyclist','bird','balloon','train','metro','plane','duck','fish','butterfly','rabbit','deer','kite','reader','picnic','couple','walker','airshow','banner','hangglider','jetski','sailboat','cruise','yacht','dolphin','flock','skateboarder','rollerskater','windsurfer'];
  const RARE_TYPES=['abduction','fireworks'];
  const NIGHT_TYPES=['meteor',...EVENT_TYPES.filter(type=>!['bird','butterfly'].includes(type))];
  const NIGHT_REGULARS=['meteor','metro','plane'];
  const WATER_TYPES=['jetski','sailboat','cruise','yacht','dolphin','windsurfer'];
  const EVENT_DURATIONS={skateboarder:65,rollerskater:75,windsurfer:95,fireworks:9,flock:65,dolphin:8,duck:80,fish:5,butterfly:35,rabbit:22,deer:55,kite:90,reader:140,picnic:150,couple:120,walker:60,airshow:40,banner:100,hangglider:90,meteor:1.8,jetski:32,sailboat:140,cruise:180,yacht:95};
  const INITIAL_TYPES=EVENT_TYPES.filter(type=>type!=='dolphin');
  function createWorld(random=Math.random){
    const world={random,elapsed:0,events:[],next:3+random()*6,lastRare:-RARE_COOLDOWN,rareCount:0,wind:.6+random()*1.2};
    // Start mid-journey so returning never waits for a first event. Pick three
    // distinct ordinary visitors; the rare abduction is never in the opening cast.
    const pool=INITIAL_TYPES.slice();
    while(world.events.length<3&&pool.length){
      const index=Math.min(pool.length-1,Math.floor(clamp(random(),0,1-.0000001)*pool.length));
      spawn(world,pool.splice(index,1)[0],true);
    }
    return world;
  }
  function spawn(w,type,initial=false){
    if(['banner','meteor','bird','dolphin'].includes(type)&&w.events.some(e=>e.type===type))return;
    if(WATER_TYPES.includes(type)&&w.events.filter(e=>WATER_TYPES.includes(e.type)).length>=2)return;
    const r=w.random;
    if(type==='dolphin'&&r()>.35)return; // A short, occasional surprise, never an opening attraction.
    const base=EVENT_DURATIONS[type]|| (type==='abduction'?24:type==='bird'?28:type==='balloon'?150:type==='plane'?95:48+r()*50);
    const duration=base*((type==='abduction'||type==='fireworks')?1:.8+r()*.4);
    w.events.push({type,age:initial?duration*(.15+r()*.45):0,duration,lane:r(),seed:r(),reverse:r()>.5});
  }
  function advance(w,dt,sky){
    if(!Number.isFinite(dt)||dt<=0)return w;
    w.elapsed+=dt;
    w.events=w.events.filter(e=>{e.age+=dt;return e.age<e.duration;});
    if(w.elapsed>=w.next){
      const r=w.random,a=activity(sky);
      w.next=w.elapsed+(7+r()*18)/a;
      if(w.events.length<MAX_EVENTS){
        if(w.elapsed-w.lastRare>=RARE_COOLDOWN && r()<.025){
          spawn(w,sky.sun.altitude < -6&&r()<.5?'fireworks':'abduction');w.lastRare=w.elapsed;w.rareCount++;
        }else{
          const choices=sky.sun.altitude < -6?(r()<.75?NIGHT_REGULARS:NIGHT_TYPES):EVENT_TYPES;
          const type=choices[Math.min(choices.length-1,Math.floor(clamp(r(),0,1-.0000001)*choices.length))];
          spawn(w,type);
        }
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
  function sceneDate(now,storage,location){
    const date=new Date(now),time=readSceneTime(storage);
    if(time==='sunrise'||time==='sunset')return sunTimes(date,location)[time==='sunrise'?'rise':'set']||date;
    if(time){const [hour,minute]=time.split(':').map(Number);date.setHours(hour,minute,0,0);}
    return date;
  }
  const MOTION_KEY='fvp:chain-scanner:landscape-motion';
  const normalizeMotion=v=>v==='normal'||v==='reduced'?v:null;
  function readMotion(storage){try{return normalizeMotion(storage.getItem(MOTION_KEY));}catch{return null;}}
  function saveMotion(storage,value){try{storage.setItem(MOTION_KEY,value);return true;}catch{return false;}}
  function motionReduced(value,osReduced){return !!osReduced||normalizeMotion(value)!=='normal';}
  root.LivingSky={skinTone,sceneDate,readSceneTime,saveSceneTime,skyAt,sunTimes,starAt,starCount:root.SKY_STARS.length,palette,activity,createWorld,advance,
    nightEventTypes:NIGHT_TYPES.slice(),eventTypes:EVENT_TYPES.slice(),rareTypes:RARE_TYPES.slice(),eventDurations:Object.assign({},EVENT_DURATIONS),MAX_EVENTS,RARE_COOLDOWN,readMotion,saveMotion,motionReduced,clamp,lerp,smooth,mixHex};
})(globalThis);
