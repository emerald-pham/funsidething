// Only the external Firebase SDK is synthetic. Product assets and workers are immutable Git bytes.
export function browserInit({dbName, authMode, sdkBase}) {
  window.__installedFixture={documentId:crypto.randomUUID(),authMode};
  window.CHAIN_STORAGE_DB_NAME=dbName;
  Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({apiKey:'isolated-regression',projectId:'isolated-regression'})});
  const install=()=>{
    if(!document.head)return false;
    const tag=document.createElement('script');tag.type='importmap';
    tag.textContent=JSON.stringify({imports:Object.fromEntries(['firebase-app.js','firebase-auth.js','firebase-firestore.js'].map(file=>['https://www.gstatic.com/firebasejs/10.12.2/'+file,sdkBase+file]))});
    document.head.prepend(tag);return true;
  };
  if(!install()){const observer=new MutationObserver(()=>{if(install())observer.disconnect();});observer.observe(document,{childList:true,subtree:true});}
  localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
  localStorage.setItem('fvp:chain-scanner:theme','light');
}
export const appModule='export const initializeApp=config=>({config});';
export const authModule=`
const auth={currentUser:window.__installedFixture.authMode==='reconcile-held'?{uid:'owner',email:'fixture@example.invalid'}:null};let listener;
export const browserLocalPersistence={};export const getAuth=()=>auth;export const setPersistence=async()=>{};
export class GoogleAuthProvider{setCustomParameters(value){this.customParameters=value;}}
export const signInWithPopup=async()=>{throw Error('No real authentication in regression fixture');};
export const signOut=async()=>{auth.currentUser=null;listener?.(null);};
export function onAuthStateChanged(_auth,next){listener=next;window.__fixtureCloudSync=window.CloudSync;next(auth.currentUser);return()=>{listener=null;};}
`;
export const firestoreModule=`
const rpc=(kind,args)=>window.__installedRPC(kind,args),ref=(...parts)=>({path:parts.filter(x=>x!==undefined).join('/'),id:String(parts.at(-1))});
const clone=x=>x&&typeof x==='object'?(x.__serverTimestamp?{toMillis:()=>x.at}:Array.isArray(x)?x.map(clone):Object.fromEntries(Object.entries(x).map(([k,v])=>[k,clone(v)]))):x;
const snap=(r,v)=>({id:r.id,ref:r,exists:()=>v!==null,data:()=>clone(v),metadata:{fromCache:false,hasPendingWrites:false}});
export const getFirestore=()=>({});export const doc=(_db,...p)=>ref(...p);export const collection=(_db,...p)=>ref(...p);export const serverTimestamp=()=>({__serverTimestamp:true,at:Date.now()});
export async function getDoc(r){return snap(r,await rpc('get',[r.path]));}export const getDocFromServer=getDoc;
export async function getDocs(r){return{docs:(await rpc('list',[r.path])).map(([p,v])=>snap(ref(...p.split('/')),v))};}export const getDocsFromServer=getDocs;
export async function runTransaction(_db,fn){const ops=[],tx={get:getDoc,set:(r,v)=>ops.push(['set',r.path,v]),update:(r,v)=>ops.push(['update',r.path,v]),delete:r=>ops.push(['delete',r.path])};const result=await fn(tx);await rpc('apply',[ops]);return result;}
export function writeBatch(){const ops=[];return{set:(r,v)=>ops.push(['set',r.path,v]),delete:r=>ops.push(['delete',r.path]),async commit(){await rpc('apply',[ops]);}};}
export const disableNetwork=async()=>{};export const enableNetwork=async()=>{};export const onSnapshot=()=>()=>{};
`;
export function fixture(mode) {
  const account=mode==='reconcile-held'?'fixture@example.invalid':null;
  return {v:1,tasks:[{id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}}],contexts:[],chain:[],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'scan',scanMode:'descending',candidateId:null,passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:false,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:account,syncRev:account?4:0,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:8},futureBoard:{opaque:['retain',11]}};
}
