/* Device-local location opt-in for the landscape. No geocoder or network
   service is involved: the optional city caption comes from a small set of
   deliberately approximate, hand-authored anchors below. */
(function(root){
  'use strict';

  const KEY='fvp:chain-scanner:location';
  const DEFAULT=Object.freeze({latitude:28.5383,longitude:-81.3792,
    timezone:'America/New_York',label:'Orlando, FL',enabled:false});
  // These are broad visual-caption anchors, not a promise of municipal
  // boundaries. A label is prefixed with "Near" and omitted when the closest
  // anchor is too far away to be a useful description.
  const CITY_DATA=Object.freeze([
    ['Orlando, FL',28.5383,-81.3792],['Miami, FL',25.7617,-80.1918],
    ['New York, NY',40.7128,-74.0060],['Chicago, IL',41.8781,-87.6298],
    ['San Francisco, CA',37.7749,-122.4194],['Los Angeles, CA',34.0522,-118.2437],
    ['Seattle, WA',47.6062,-122.3321],['Denver, CO',39.7392,-104.9903],
    ['Toronto, ON',43.6532,-79.3832],['Mexico City, MX',19.4326,-99.1332],
    ['London, UK',51.5074,-0.1278],['Paris, FR',48.8566,2.3522],
    ['Berlin, DE',52.5200,13.4050],['Oslo, NO',59.9139,10.7522],
    ['Tromso, NO',69.6492,18.9553],['Reykjavik, IS',64.1466,-21.9426],
    ['Sao Paulo, BR',-23.5505,-46.6333],['Cape Town, ZA',-33.9249,18.4241],
    ['Sydney, AU',-33.8688,151.2093],['Singapore, SG',1.3521,103.8198],
    ['Tokyo, JP',35.6762,139.6503],['Delhi, IN',28.6139,77.2090]
  ]);
  const EVENT_NAME={
    1:'Location permission was denied.',
    2:'Your location is unavailable right now.',
    3:'Location lookup timed out.'
  };

  let storage=null,navigatorRef=null,documentRef=null,state=clone(DEFAULT),lastError=null;

  function clone(value){return {latitude:value.latitude,longitude:value.longitude,
    timezone:value.timezone,label:value.label,enabled:value.enabled};}
  function validTimezone(value){
    if(typeof value!=='string'||!value.trim())return false;
    try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format();return true;}catch{return false;}
  }
  function deviceTimezone(){
    try{
      const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
      return validTimezone(zone)?zone:DEFAULT.timezone;
    }catch{return DEFAULT.timezone;}
  }
  function cleanLabel(value){
    if(value===undefined||value===null)return '';
    if(typeof value!=='string')throw new TypeError('Location label must be text');
    return value.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80);
  }
  function distanceKm(a,b){
    const r=Math.PI/180,lat1=a[1]*r,lat2=b[1]*r,dLat=(b[1]-a[1])*r,dLon=(b[2]-a[2])*r;
    const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function nearestLabel(latitude,longitude){
    const here=[0,latitude,longitude]; let best=null;
    for(const city of CITY_DATA){const km=distanceKm(here,city);if(!best||km<best.km)best={city,km};}
    return best&&best.km<=220?'Near '+best.city[0]:'Saved location';
  }
  function normalize(value){
    if(!value||typeof value!=='object')throw new TypeError('Location object required');
    const latitude=value.latitude,longitude=value.longitude;
    if(typeof latitude!=='number'||!Number.isFinite(latitude)||latitude<-90||latitude>90)throw new RangeError('Invalid latitude');
    if(typeof longitude!=='number'||!Number.isFinite(longitude)||longitude<-180||longitude>180)throw new RangeError('Invalid longitude');
    const timezone=value.timezone===undefined?deviceTimezone():value.timezone;
    if(!validTimezone(timezone))throw new RangeError('Invalid timezone');
    const label=cleanLabel(value.label)||nearestLabel(latitude,longitude);
    return {latitude,longitude,timezone,label,enabled:value.enabled!==false};
  }
  function storageRef(){
    if(storage!==null)return storage;
    try{return root.localStorage||null;}catch{return null;}
  }
  function readSaved(){
    const backend=storageRef();
    if(!backend||typeof backend.getItem!=='function')return null;
    try{
      const raw=backend.getItem(KEY); if(!raw)return null;
      const parsed=JSON.parse(raw); return parsed&&parsed.enabled===true?normalize(parsed):null;
    }catch{return null;}
  }
  function persist(next){
    const backend=storageRef();
    if(!backend||typeof backend.setItem!=='function')return false;
    try{backend.setItem(KEY,JSON.stringify(next));return true;}catch{return false;}
  }
  function removeSaved(){
    const backend=storageRef();
    if(!backend||typeof backend.removeItem!=='function')return false;
    try{backend.removeItem(KEY);return true;}catch{return false;}
  }
  function emit(){
    if(!documentRef||typeof documentRef.dispatchEvent!=='function')return;
    try{
      const detail=current();
      const EventCtor=root.CustomEvent||((type,opts)=>({type,...opts}));
      documentRef.dispatchEvent(new EventCtor('landscape-location-change',{detail}));
    }catch{}
  }
  function current(){return clone(state);}
  function caption(){return state.enabled?state.label:'';}
  function init(options={}){
    if(Object.prototype.hasOwnProperty.call(options,'storage'))storage=options.storage;
    else if(storage===null)storage=storageRef();
    if(Object.prototype.hasOwnProperty.call(options,'navigator'))navigatorRef=options.navigator;
    else if(navigatorRef===null){try{navigatorRef=root.navigator||null;}catch{navigatorRef=null;}}
    if(Object.prototype.hasOwnProperty.call(options,'document'))documentRef=options.document;
    else if(documentRef===null)documentRef=root.document||null;
    const saved=readSaved(); state=saved||clone(DEFAULT); lastError=null; render(); return current();
  }
  function geoError(error){
    const code=error&&error.code; const out=new Error(EVENT_NAME[code]||'Location lookup failed.');
    out.name='LocationError';out.code=code||'POSITION_UNAVAILABLE';return out;
  }
  function saveCoordinates(coords,options={}){
    if(!coords||typeof coords!=='object')throw new TypeError('Coordinates required');
    const next=normalize({latitude:coords.latitude,longitude:coords.longitude,
      timezone:options.timezone===undefined?deviceTimezone():options.timezone,
      label:options.label,enabled:true});
    if(!persist(next)){const error=new Error('Location could not be saved in device storage.');error.code='STORAGE';throw error;}
    state=next;lastError=null;emit();render();return current();
  }
  function request(options={}){
    const nav=options.navigator||navigatorRef;
    const geo=nav&&nav.geolocation;
    if(!geo||typeof geo.getCurrentPosition!=='function'){
      const error=geoError({code:2});lastError=error;render();return Promise.reject(error);
    }
    return new Promise((resolve,reject)=>{
      const success=position=>{
        try{resolve(saveCoordinates(position&&position.coords,options));}
        catch(error){lastError=error;render();reject(error);}
      };
      const failure=error=>{lastError=geoError(error);render();reject(lastError);};
      try{geo.getCurrentPosition(success,failure,{enableHighAccuracy:false,maximumAge:300000,timeout:15000});}
      catch(error){lastError=error instanceof Error?error:geoError({code:2});render();reject(lastError);}
    });
  }
  function setLabel(value){
    if(!state.enabled)return current();
    const label=cleanLabel(value)||nearestLabel(state.latitude,state.longitude);
    const next=Object.assign(clone(state),{label});
    if(!persist(next)){const error=new Error('Location name could not be saved in device storage.');error.code='STORAGE';throw error;}
    state=next;lastError=null;emit();render();return current();
  }
  function reset(){
    state=clone(DEFAULT);lastError=null;const removed=removeSaved();
    if(!removed&&storageRef())lastError=Object.assign(new Error('Location preference could not be cleared from this device.'),{code:'STORAGE'});
    emit();render();return current();
  }

  function byAction(action){
    if(!documentRef||typeof documentRef.querySelector!=='function')return null;
    return documentRef.querySelector('[data-location-action="'+action+'"]');
  }
  function setStatus(text){const el=documentRef&&documentRef.getElementById&&documentRef.getElementById('locationStatus');if(el)el.textContent=text||'';}
  function render(){
    if(!documentRef||typeof documentRef.getElementById!=='function')return;
    const label=documentRef.getElementById('locationCurrent');if(label)label.textContent=state.enabled?state.label:'Using the default sky. Enable location to make it yours.';
    const input=documentRef.getElementById('locationName');if(input&&documentRef.activeElement!==input)input.value=state.enabled&&state.label.indexOf('Near ')!==0?state.label:'';
    const resetButton=byAction('reset');if(resetButton)resetButton.hidden=!state.enabled;
    const saveButton=byAction('save-name');if(saveButton)saveButton.hidden=!state.enabled;
    if(lastError)setStatus(lastError.message);
    else if(state.enabled)setStatus('Saved on this device.');
    else setStatus('Your browser will ask only after you choose Use my location.');
  }
  function openDialog(){
    if(!documentRef||typeof documentRef.getElementById!=='function')return;
    const dialog=documentRef.getElementById('locationDialog');if(!dialog)return;
    render();try{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.open=true;}catch{}
    const requestButton=byAction('request');if(requestButton&&typeof requestButton.focus==='function')requestButton.focus();
  }
  function closeDialog(){const dialog=documentRef&&documentRef.getElementById&&documentRef.getElementById('locationDialog');if(dialog&&typeof dialog.close==='function')dialog.close();else if(dialog)dialog.open=false;}
  function bind(){
    if(!documentRef||typeof documentRef.addEventListener!=='function')return;
    documentRef.addEventListener('click',event=>{
      const target=event.target&&event.target.closest?event.target.closest('[data-act],[data-location-action]'):null;
      if(!target)return;
      const act=target.dataset&&target.dataset.act,local=target.dataset&&target.dataset.locationAction;
      if(act==='location-settings'){event.preventDefault();openDialog();return;}
      if(local==='close'){event.preventDefault();closeDialog();return;}
      if(local==='request'){
        event.preventDefault();setStatus('Requesting your browser location…');
        request().then(()=>{}).catch(()=>{});return;
      }
      if(local==='save-name'){
        event.preventDefault();const input=documentRef.getElementById('locationName');try{setLabel(input&&input.value);}catch(error){lastError=error;render();}return;
      }
      if(local==='reset'){event.preventDefault();reset();return;}
    });
    documentRef.addEventListener('landscape-location-change',render);
  }

  const api={KEY,DEFAULT,CITY_DATA,current,caption,init,normalize,nearestLabel,request,saveCoordinates,setLabel,reset,
    get lastError(){return lastError;}};
  root.LivingLocation=api;
  init();bind();
})(globalThis);
