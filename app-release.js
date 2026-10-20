/* Public deployment identity for the release-scoped Help notice. Metadata is
   deliberately fetched outside the offline shell cache and fails closed. */
(()=>{
  const NOTICE_ID="sync-stability-2026-10";
  const DESTINATIONS=Object.freeze({
    beta:Object.freeze({origin:"https://chain-scanner.web.app",basePath:"/"}),
    stable:Object.freeze({origin:"https://emerald-pham.github.io",basePath:"/funsidething/"}),
  });
  let current=null,status="loading",requestNumber=0,inFlight=null;
  const freeze=value=>{
    if(value&&typeof value==="object"&&!Object.isFrozen(value)){
      for(const child of Object.values(value))freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  const api=Object.freeze({get current(){return current;},get status(){return status;}});
  Object.defineProperty(window,"ChainRelease",{value:api,enumerable:false,configurable:false,writable:false});

  function notify(nextStatus,nextCurrent){
    status=nextStatus;current=nextCurrent;
    window.dispatchEvent(new CustomEvent("appreleasechange",{detail:{status,current}}));
  }
  function isoMillis(value){
    if(typeof value!=="string"||value.length>30||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))return null;
    const number=Date.parse(value);
    return Number.isFinite(number)&&new Date(number).toISOString()===value?number:null;
  }
  function templateFingerprint(){
    const html=document.getElementById("appChangelogCurrent")?.innerHTML||"";
    return html.match(/\bdata-app-fingerprint=["']([a-f0-9]{64})["']/)?.[1]||null;
  }
  function validPage(channel){
    const destination=DESTINATIONS[channel];
    if(!destination)return false;
    const page=new URL(window.location.href);
    return page.origin===destination.origin&&
      (page.pathname===destination.basePath||page.pathname===destination.basePath+"index.html");
  }
  function exactKeys(value,keys){
    return value&&typeof value==="object"&&!Array.isArray(value)&&
      Object.keys(value).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
  }
  function noticeContinuation(value,channel,deployedAt,startsAt){
    if(!exactKeys(value,["schemaVersion","channel","origin","basePath","noticeId","originalProduct","originalDeployedAt","originalStartsAt","evidence"])||
       value.schemaVersion!==1||channel!=="beta"||value.channel!==channel||
       value.origin!==DESTINATIONS.beta.origin||value.basePath!==DESTINATIONS.beta.basePath||value.noticeId!==NOTICE_ID)return null;
    const product=value.originalProduct,evidence=value.evidence;
    if(!exactKeys(product,["sourceRevision","tree","appFingerprint"])||
       !/^[a-f0-9]{40}$/.test(product.sourceRevision||"")||!/^[a-f0-9]{40}$/.test(product.tree||"")||
       !/^[a-f0-9]{64}$/.test(product.appFingerprint||"")||
       !exactKeys(evidence,["artifactSha256","publicationSha256","publicVerificationSha256"])||
       !Object.values(evidence).every(hash=>typeof hash==="string"&&/^[a-f0-9]{64}$/.test(hash)))return null;
    const originalDeployedAt=isoMillis(value.originalDeployedAt),originalStartsAt=isoMillis(value.originalStartsAt);
    if(originalDeployedAt===null||originalStartsAt===null||originalDeployedAt>originalStartsAt||
       originalDeployedAt>deployedAt||originalStartsAt!==startsAt)return null;
    // These references make the publisher's reviewed original evidence auditable;
    // they are not an additional authority or a request to another service.
    return {schemaVersion:1,channel,origin:value.origin,basePath:value.basePath,noticeId:NOTICE_ID,
      originalProduct:{sourceRevision:product.sourceRevision,tree:product.tree,appFingerprint:product.appFingerprint},
      originalDeployedAt:value.originalDeployedAt,originalStartsAt:value.originalStartsAt,
      evidence:{artifactSha256:evidence.artifactSha256,publicationSha256:evidence.publicationSha256,publicVerificationSha256:evidence.publicVerificationSha256}};
  }
  function validateEnvelope(value,requestUrl,nonce,pageIdentity){
    if(!value||typeof value!=="object"||Array.isArray(value)||value.schemaVersion!==1||
       !["beta","stable"].includes(value.channel))return null;
    const destination=DESTINATIONS[value.channel];
    if(!destination||value.origin!==destination.origin||value.basePath!==destination.basePath||!validPage(value.channel))return null;
    const product=value.product,notice=value.notices?.[NOTICE_ID],fingerprint=templateFingerprint();
    if(!product||typeof product!=="object"||
       !/^[a-f0-9]{40}$/.test(product.sourceRevision||"")||
       !/^[a-f0-9]{40}$/.test(product.tree||"")||
       !/^[a-f0-9]{64}$/.test(product.appFingerprint||"")||
       !fingerprint||product.appFingerprint!==fingerprint||
       !notice||typeof notice!=="object")return null;
    const deployedAt=isoMillis(value.deployedAt),startsAt=isoMillis(notice.startsAt),now=Date.now();
    if(deployedAt===null||startsAt===null||deployedAt>now+300000)return null;
    let continuation=null;
    if(Object.prototype.hasOwnProperty.call(notice,"continuation")){
      continuation=noticeContinuation(notice.continuation,value.channel,deployedAt,startsAt);
      if(!continuation)return null;
    }
    if(startsAt<deployedAt&&!continuation)return null;
    const responseUrl=new URL(requestUrl.href);
    if(!pageIdentity()||pageIdentity()!==pageIdentityAtLoad)return null;
    return freeze({
      schemaVersion:1,
      channel:value.channel,
      origin:destination.origin,
      basePath:destination.basePath,
      product:{sourceRevision:product.sourceRevision,tree:product.tree,appFingerprint:product.appFingerprint},
      deployedAt:value.deployedAt,
      notices:{[NOTICE_ID]:{startsAt:notice.startsAt,...(continuation?{continuation}:{})}},
      _response:{origin:responseUrl.origin,path:responseUrl.pathname,search:responseUrl.search,nonce},
    });
  }
  function pageIdentity(){
    try{const page=new URL(window.location.href);return page.origin+page.pathname;}
    catch(error){return null;}
  }
  let pageIdentityAtLoad=pageIdentity();

  async function load(){
    let controller=null,timer=null;
    const nonce=Date.now().toString(36)+"-"+(++requestNumber).toString(36);
    try{
      const page=new URL(window.location.href);
      const channel=page.origin===DESTINATIONS.beta.origin?"beta":page.origin===DESTINATIONS.stable.origin?"stable":null;
      if(!channel||!validPage(channel))throw Error("unverified release destination");
      const destination=DESTINATIONS[channel],requestUrl=new URL(destination.basePath+"channel-release.json",destination.origin);
      requestUrl.searchParams.set("release",nonce);
      const Abort=window.AbortController||globalThis.AbortController;
      if(typeof Abort!=="function"||typeof window.fetch!=="function")throw Error("release network unavailable");
      controller=new Abort();
      const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("release metadata timed out"));},5000);});
      const response=await Promise.race([window.fetch(requestUrl.href,{credentials:"omit",cache:"no-store",redirect:"error",mode:"same-origin",signal:controller.signal}),timeout]);
      if(!response?.ok||response.redirected||response.type!=="basic"||typeof response.url!=="string")throw Error("release response rejected");
      const responseUrl=new URL(response.url);
      if(responseUrl.origin!==destination.origin||responseUrl.pathname!==destination.basePath+"channel-release.json"||responseUrl.search!=="?release="+encodeURIComponent(nonce))throw Error("release response destination mismatch");
      const value=await response.json();
      const parsed=validateEnvelope(value,requestUrl,nonce,pageIdentity);
      if(!parsed||parsed.channel!==channel||parsed._response.origin!==destination.origin||parsed._response.path!==requestUrl.pathname||parsed._response.search!==requestUrl.search)throw Error("release envelope rejected");
      const { _response, ...publicEnvelope }=parsed;
      if(pageIdentity()!==pageIdentityAtLoad)throw Error("page destination changed during release load");
      notify("verified",freeze(publicEnvelope));
    }catch(error){notify("unavailable",null);}
    finally{if(timer!==null)clearTimeout(timer);}
    return current;
  }
  function refresh(){
    if(inFlight)return inFlight;
    inFlight=load().finally(()=>{inFlight=null;});
    return inFlight;
  }
  for(const event of ["online","pageshow","focus"]){
    window.addEventListener(event,()=>{pageIdentityAtLoad=pageIdentity();refresh();});
  }
  refresh();
})();
