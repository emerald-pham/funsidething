/* Offline sky and bounded event scheduling. No scanner state, DOM or network.
   Florida is an explicit observer, not an inference from the device timezone. */
(function(root){
  'use strict';
  const A=root.Astronomy, RAD=Math.PI/180;
  const observer=new A.Observer(28.5383,-81.3792,20);
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
  function validDate(date){if(!(date instanceof Date)||!Number.isFinite(+date))throw new TypeError('Valid date required');}
  function bodyAt(body,date){
    const eq=A.Equator(body,date,observer,true,true);
    const h=A.Horizon(date,observer,eq.ra,eq.dec,'normal');
    return {altitude:h.altitude,azimuth:h.azimuth,visible:h.altitude>-.3};
  }
  function sunTimes(date){
    validDate(date);
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date);
    const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    // 04:00 UTC is local midnight in summer, 23:00 on the preceding winter
    // date. Both are safely before Florida's first solar rise/set of this day.
    const start=new Date(Date.UTC(+values.year,+values.month-1,+values.day,4));
    return {rise:A.SearchRiseSet('Sun',observer,1,start,1).date,set:A.SearchRiseSet('Sun',observer,-1,start,1).date};
  }
  function starAt(date,row,rotation){
    const ra=row[0]*15*RAD,dec=row[1]*RAD;
    const v=new A.Vector(Math.cos(dec)*Math.cos(ra),Math.cos(dec)*Math.sin(ra),Math.sin(dec),date);
    const eq=A.EquatorFromVector(A.RotateVector(rotation||A.Rotation_EQJ_EQD(date),v));
    const h=A.Horizon(date,observer,eq.ra,eq.dec,'normal');
    return {azimuth:h.azimuth,altitude:h.altitude,magnitude:row[2],colorIndex:row[3]||0};
  }
  function skyAt(date){
    validDate(date);
    const sun=bodyAt('Sun',date),moon=bodyAt('Moon',date),phase=A.MoonPhase(date);
    const rotation=A.Rotation_EQJ_EQD(date);
    return {date,sun,moon,phase,illumination:(1-Math.cos(phase*RAD))/2,
      period:sun.altitude < -12?'night':sun.altitude<8?(sun.azimuth<180?'dawn':'dusk'):'day',
      stars:root.SKY_STARS.map(row=>starAt(date,row,rotation)).filter(s=>s.altitude>0)};
  }
  // Shared anchor stops keep every sky and terrain layer continuous across twilight.
  const STOPS=[
    [-18,['#071323','#152c46','#3b5360','#293e51','#203b42','#193632','#102b2b','#92acb8']],
    [-9, ['#18283e','#59617a','#b4888e','#62677a','#435d60','#304e48','#203e37','#c8a8af']],
    [-1, ['#597c99','#dbaaa0','#f7d9ae','#ac9c9c','#829d8a','#547d62','#325e46','#cc976a']],
    [7,  ['#7daaba','#c7dad3','#f5e7c0','#9bb3b1','#8faa8b','#6e946c','#456f52','#b38b60']],
    [35, ['#79b1c8','#c6e0df','#edf0d8','#9ebbbc','#8fae98','#749b76','#4b795d','#879f8e']]
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
  function activity(sky){return sky.sun.altitude < -6?.24:sky.sun.azimuth<180?1:.65;}
  const MAX_EVENTS=14,RARE_COOLDOWN=420;
  const EVENT_TYPES=['cyclist','bird','balloon','train','metro','plane'];
  function createWorld(random=Math.random){
    const world={random,elapsed:0,events:[],next:3+random()*6,lastRare:-RARE_COOLDOWN,rareCount:0};
    // Start mid-journey so returning never waits for a first event. Cloud drift
    // and wind are persistent, separate from this randomized event population.
    for(const type of ['metro',random()<.5?'cyclist':'bird',random()<.5?'balloon':'plane'])spawn(world,type,true);
    return world;
  }
  function spawn(w,type,initial=false){
    const r=w.random;
    const duration=type==='abduction'?24:type==='bird'?28:type==='balloon'?150:type==='plane'?95:48+r()*50;
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
          spawn(w,'abduction');w.lastRare=w.elapsed;w.rareCount++;
        }else{
          const type=sky.sun.altitude < -6 ? (r()<.7?'metro':'plane') : EVENT_TYPES[Math.min(5,Math.floor(r()*6))];
          spawn(w,type);
        }
      }
    }
    return w;
  }
  const MOTION_KEY='fvp:chain-scanner:landscape-motion';
  const normalizeMotion=v=>v==='normal'||v==='reduced'?v:null;
  function readMotion(storage){try{return normalizeMotion(storage.getItem(MOTION_KEY));}catch{return null;}}
  function saveMotion(storage,value){try{storage.setItem(MOTION_KEY,value);return true;}catch{return false;}}
  function motionReduced(value,osReduced){return !!osReduced||normalizeMotion(value)!=='normal';}
  root.LivingSky={skyAt,sunTimes,starAt,starCount:root.SKY_STARS.length,palette,activity,createWorld,advance,
    MAX_EVENTS,RARE_COOLDOWN,readMotion,saveMotion,motionReduced,clamp,lerp,smooth,mixHex};
})(globalThis);
