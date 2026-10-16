/* Walking recipes keep the shared admission clock, full route and local paint
   completion distinct. This module owns visit lifetimes and geometry-specific
   presentation; the timeline still decides which seeded opportunities to admit. */
(function(root){
  'use strict';
  // (8192 + 112) / 3.5 travel plus 240 / .82 activity and bounded clock
  // offset stays below 2700 seconds for the approved canonical geometry.
  const MAX_VISIT_LIFETIME=2700;
  const WALKING_TYPES=new Set(['walker','dogwalker','reader','couple','picnic','kite','snowman','snowangel','skier']);
  function create(){
    const canonicalGeometry=root.LandscapeGeometry.create(8192,900),durations=new WeakMap();
    const paintEnds=new Map();let paintGeometry=null;
    const fullDuration=event=>{
      if(!durations.has(event))durations.set(event,canonicalGeometry.walkingLifetime(event));
      return durations.get(event);
    };
    const duration=event=>WALKING_TYPES.has(event.type)?fullDuration(event):event.duration;
    const recipe=event=>{
      if(!WALKING_TYPES.has(event.type))return event;
      const visit={...event,activityDuration:event.duration};
      Object.defineProperty(visit,'duration',{enumerable:true,get:()=>fullDuration(event)});
      return visit;
    };
    const fitsUtcDay=(event,reservationDuration,dayEnd)=>{
      const fullFit=event.start+MAX_VISIT_LIFETIME>dayEnd?Math.max(duration(event),reservationDuration):reservationDuration;
      return event.start+fullFit<=dayEnd;
    };
    const inWindow=(events,from,to)=>events.filter(event=>
      event.start>=from-MAX_VISIT_LIFETIME&&event.start<to&&event.start+event.duration>from);
    // Finish walking selection before painter consumers; keep other event poses with their compositor.
    const forPaint=(events,geometry,reducedMotion,{poseOther=event=>event,membershipOnly=false}={})=>{
      if(paintGeometry!==geometry){paintGeometry=geometry;paintEnds.clear();}
      const painted=[];
      for(const event of events){
        if(!WALKING_TYPES.has(event.type)){painted.push(poseOther(event));continue;}
        if(!event.activityDuration){painted.push(poseOther(event));continue;}
        if(reducedMotion){
          if(event.age<event.activityDuration)painted.push(membershipOnly?event:{...event,age:geometry.stillWalkingAge(event)});
          continue;
        }
        const key=JSON.stringify([event.id,event.type,event.activityDuration,event.seed,event.lane,event.reverse]);
        if(!paintEnds.has(key)){
          paintEnds.set(key,geometry.walkingLifetime(event));
          // At most 345 recipes can be current; keep the local memo bounded across frame ages.
          if(paintEnds.size>1024)paintEnds.delete(paintEnds.keys().next().value);
        }
        if(event.age<paintEnds.get(key))painted.push(event);
      }
      return painted;
    };
    return {recipe,fitsUtcDay,inWindow,forPaint};
  }
  root.LandscapeVisits={create};
})(globalThis);
