import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deriveOrdinaryStartupObservation} from './button-safety-startup.mjs';
import {verifyNativeTimelineCapture,deriveNativeTimelineEvidence} from './button-safety-timeline-core.mjs';
export function sourceButtonTemplates(source){
 const counts={};
 for(const match of source.matchAll(/<(?:button|summary)\b[^>]*>|<[a-z][^>]*\b(?:data-act|data-scene-view|data-landscape-motion|data-scene-time|data-scene-preset|data-location-action|role\s*=\s*[\"']button[\"'])[^>]*>|createElement\(\s*['"](?:button|summary)['"]\s*\)/g)){const key=digest(match[0]);counts[key]=(counts[key]||0)+1;}
 return Object.fromEntries(Object.entries(counts).sort(([a],[b])=>a.localeCompare(b)));
}
export function verifyButtonInventorySource(source,inventory){
 assert.deepEqual(sourceButtonTemplates(source),inventory.sourceTemplates,'Source button templates differ from reviewed native inventory');return true;
}
export const digest=value=>createHash('sha256').update(value).digest('hex');
// Fixed recipe slots name only the finite return skeleton. Arbitrary artifact
// keys and values always keep their own canonical a/j addresses.
const REFERENCE_MODULES=['scripts/button-safety.mjs','scripts/button-safety-contract.mjs','scripts/button-safety-startup.mjs','scripts/button-safety-timeline-core.mjs'];
const REFERENCE_GAPS=[
 'Application source/operation/required-or-optional roles unbound',
 'Background/safe-board/visible-response states require independent exact pixel annotations',
 'Human names on source-located scopes unavailable; point stacks are not named-span associations',
 'Native instrumentation is observed synchronous scope elapsed time, not CPU usage',
 'Snapshots establish bounded observed engine content; first occurrence, OS presentation and every-frame coverage unverified',
 'Only initial session/document/epoch supported; provisional branch unvalidated',
 'Original1472 producer identity is distinct from this later consumer; later producer execution unproved',
 'Instrumented scope elapsed time is not CPU usage',
 'Missing frames/every-frame coverage, OS presentation and first occurrence unverified',
 'Mixed/anonymous/unassociated app caller names and roles remain unclassified',
 'Later producer execution is distinct from original1472; root route decision required',
 'Missing background observation','Missing safe-board observation','Missing visible-response observation',
 'Partial native prefix cannot establish ordinary startup clock/input/custody or completed capture'
];
const observationSlots=name=>[name,...['status','reason','nativeInterval','nativeInterval.0','nativeInterval.1','pageInterval','pageInterval.startMs','pageInterval.endMs','pageInterval.uncertaintyMs','framePath','frameSha256','eventIndex','recordPath','documentId','sessionId','epoch','nativeContextId','documentAssociation','firstOccurrence','annotation','interactivity'].map(p=>name+'.'+p)];
const REFERENCE_SLOTS=[
 ['', 'observedBackgroundToBoardSeparation','status','evidenceKind','ordinaryRouteEligible','requiresRootDecision','nativeEvidence','sourceManifest','trustedInput','custody','observations','workIntervals','gaps','producer','consumer'],
 ['', 'schemaVersion','status','producer','consumer','inputDigests','policy','records','workScopes','stackObservations','clock','snapshots','coverage','gaps'],
 ['', 'eventIndex','recordPath','sessionId','epoch','type','startSeconds','endSeconds','parent','data','pageInterval'],
 ['', 'eventIndex','recordPath','type','data'],
 ['', 'eventIndex','recordPath','sessionId','epoch','parent','type','kind','startSeconds','endSeconds','durationMs','callerIdentity','callerIdentity.url','callerIdentity.line','callerIdentity.column','callerIdentity.coordinateKind','callerIdentity.coordinateBasis','sourceBinding','name','nameStatus','requiredOrOptional','cpuUsage','pageInterval'],
 ['', 'eventIndex','recordPath','sessionId','epoch','type','atSeconds','stackTrace','durationAttribution','association'],
 ['', 'epoch','parent','compositeParent','pageInterval','documentAssociation','documentId','nativeDocumentId','nativeContextId','firstOccurrence','presentation','limit'],
 ['', 'eventIndex','recordPath','sessionId','epoch','prefix','nativeSeconds','contextId'],
 ['', 'status','basis','pageBasis','document','sessionId','epoch','rate','offsetMs','uncertaintyMs','anchors','empiricalRate','nativeInterval','nativeInterval.0','nativeInterval.1','limit','reason'],
 ['', 'role','observedSeparationOverlap','causation'],
 ['', 'url','sha256','bytes'],
 ['', 'kind','modules',...REFERENCE_MODULES.flatMap((_,i)=>['modules.'+i,'modules.'+i+'.path','modules.'+i+'.sha256'])],
 ['',...['firstObservedBackground','firstObservedSafeBoard','firstObservedVisibleResponse'].flatMap(observationSlots),'firstTrustedInputReceipt',...['status','atMs','basis','trusted','operationId'].map(p=>'firstTrustedInputReceipt.'+p)],
 ['', 'status','startMs','endMs','uncertaintyMs','reason'],
 ['', 'tasks','unknownOpaqueCodeUnits','postActionAddOpen','readback','allTypedStoresRetained'],
 ['', 'operationId','pointerdown','click'],
 ['', 'status','rangeMs','rangeMs.0','rangeMs.1','meaning','reason'],
 ['', 'branch','provisional','coordinateConvention','workRoles'],
 ['', 'rawEvents','rawFiles','totalRawBytes','records','workScopes','boundSourceScopes','stackObservations','stackChainCompleteness','snapshots','missingFrames','osPresentation','physicalIOS'],
 ['', 'captureSha256','rawInventorySha256','sources'],
 ['',...Array.from({length:16},(_,i)=>String(i))],
 [''],[''],[''],[''],[''],[''],[''],
 ['',...Array.from({length:64},(_,i)=>String(i))],
 ['', 'status','url','sha256','bytes','kind'],
 ['',...Array.from({length:64},(_,i)=>String(i))]
];
const REFERENCE_LITERALS=[...new Set(REFERENCE_SLOTS.flatMap(paths=>paths.flatMap(p=>p.split('.').filter(k=>k&&!/^\d+$/.test(k)))).concat(REFERENCE_GAPS))];
for(const slots of REFERENCE_SLOTS)assert.ok(slots.length<=128&&new Set(slots).size===slots.length,'Bounded unique reference recipe slots');
class StartupValueReference{constructor(ref){this.ref=ref;}}
const referenceValue=ref=>new StartupValueReference(ref),derivedReference=(kind,index=0,slot=0)=>referenceValue(slot?['d',kind,index,slot]:['d',kind,index]);
const referenceCheck=(ok,message)=>assert.ok(ok,'Startup reference '+message);
const ownReferenceValue=(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true});

// Iterative preorder includes property-key nodes immediately before each value
// subtree. Only metadata indexes survive a callback; canonical indexes do not.
function startupNodeIndex(value){
 const nodes=[],objects=new WeakMap(),pending=[{value,attach:null,key:false}];
 while(pending.length){
  const task=pending.pop(),ordinal=nodes.length,node={value:task.value,children:[]};nodes.push(node);task.attach?.(ordinal);
  if(task.key||task.value===null||typeof task.value!=='object')continue;
  objects.set(task.value,ordinal);
  if(Array.isArray(task.value)){
   node.array=true;
   for(let i=task.value.length-1;i>=0;i--)pending.push({value:task.value[i],attach:n=>{node.children[i]=n;},key:false});
  }else{
   const keys=Object.keys(task.value);node.keys=keys;
   for(let i=keys.length-1;i>=0;i--){const key=keys[i],pair=[];node.children[i]=pair;pending.push({value:task.value[key],attach:n=>{pair[1]=n;},key:false});pending.push({value:key,attach:n=>{pair[0]=n;},key:true});}
  }
 }
 const child=(ordinal,key)=>{const node=nodes[ordinal];if(!node)return undefined;if(node.array)return Number.isSafeInteger(Number(key))&&Number(key)>=0?node.children[Number(key)]:undefined;const i=node.keys?.indexOf(String(key));return i>=0?node.children[i][1]:undefined;};
 return{nodes,objects,child,path:(...keys)=>{let n=0;for(const key of keys){n=child(n,key);if(n===undefined)return undefined;}return n;}};
}

function startupReferenceContext({artifactInput,retentionProfile}={}){
 referenceCheck(artifactInput&&typeof artifactInput.reportReferencePath==='string'&&typeof artifactInput.evidencePath==='string','file-backed artifactInput required');
 const root=path.dirname(path.resolve(artifactInput.evidencePath)),audit=[0,0,0,0,0,0,0],active={event:0,parsed:0,source:0,png:0};
 const lease=(kind,peak,visit)=>{referenceCheck(active[kind]===0,'reentrant '+kind+' lease refused');active[kind]++;audit[peak]=Math.max(audit[peak],active[kind]);try{return visit();}finally{active[kind]--;}};
 const readAbsolute=file=>{
  const stat=fs.lstatSync(file);referenceCheck(!stat.isSymbolicLink()&&stat.isFile()&&fs.realpathSync(file)===file,'owned file symlink/escape refused');audit[0]++;return fs.readFileSync(file);
 };
 const ownedPath=relative=>{referenceCheck(typeof relative==='string'&&relative&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).includes('..'),'owned relative file required');return path.join(root,relative);};
 const readOwned=relative=>readAbsolute(ownedPath(relative));
 const paths=[path.resolve(artifactInput.evidencePath),path.resolve(artifactInput.reportReferencePath)],buffers=[readAbsolute(paths[0]),readAbsolute(paths[1])],documents=[JSON.parse(buffers[0]),JSON.parse(buffers[1])],spec=documents[0],reportReference=documents[1];
 paths.push(ownedPath(reportReference.reportPath));buffers.push(readAbsolute(paths[2]));referenceCheck(digest(buffers[2])===reportReference.sha256,'report reference mismatch');documents.push(JSON.parse(buffers[2]));const report=documents[2];
 referenceCheck(report.kind==='startup-diagnostic'&&report.scope==='ordinary-startup-diagnostic','ordinary diagnostic report required');for(const key of ['contextClosed','browserClosed','serverClosed'])referenceCheck(report.cleanup?.[key]===true,'owned cleanup required: '+key);
 for(const relative of [spec.capturePath,spec.rawInventoryPath,spec.fixturePath]){paths.push(ownedPath(relative));buffers.push(readAbsolute(paths.at(-1)));documents.push(JSON.parse(buffers.at(-1)));}
 const capture=documents[3],inventory=documents[4];referenceCheck(digest(buffers[3])===spec.captureSha256&&digest(buffers[4])===spec.rawInventorySha256,'original raw identity mismatch');
 const inputSet=buffers.map(b=>[digest(b),b.length]),metadata=documents.map(startupNodeIndex),sourceLengths=[];
 const moduleRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url))),implementation=REFERENCE_MODULES.map(relative=>digest(readAbsolute(path.join(moduleRoot,relative))));
 const verifyMetadata=kind=>{const bytes=readAbsolute(paths[kind]);referenceCheck(bytes.length===inputSet[kind][1]&&digest(bytes)===inputSet[kind][0],'stale metadata dependency '+kind);};
 const verifyImplementation=()=>{for(const [i,relative]of REFERENCE_MODULES.entries())referenceCheck(digest(readAbsolute(path.join(moduleRoot,relative)))===implementation[i],'stale implementation dependency');};
 const canonical=capture.schemaVersion===2||capture.schemaVersion===3;
 if(capture.schemaVersion===3){
  verifyButtonStartupCapture(capture,{retentionProfile});referenceCheck(spec.retentionProfile===retentionProfile,'selected retention profile manifest mismatch');
  const directory=path.join(root,'startup-timeline'),stat=fs.lstatSync(directory);referenceCheck(!stat.isSymbolicLink()&&stat.isDirectory()&&fs.realpathSync(directory)===directory,'raw namespace refused');
  const names=fs.readdirSync(directory);referenceCheck(!names.some(n=>n.endsWith('.png')),'selected retention profile forbids persistent PNG files');
  const expected=[...capture.events,...(capture.orphans||[])].map(r=>path.basename(r.path));referenceCheck(names.length===expected.length&&names.every(n=>expected.includes(n))&&Array.isArray(inventory)&&inventory.length===expected.length+capture.frames.length,'raw namespace mismatch');
 }else referenceCheck(retentionProfile===undefined,'retention profile does not match capture schema');
 const physicalRows=Array.isArray(inventory)?inventory.filter(r=>!canonical||r.kind!=='derived-png'):[],physicalKeys=new Set(physicalRows.map(r=>r.path));
 const rawBytes=(entry,visit)=>{
  const load=()=>{const file=ownedPath(entry.path),stat=fs.lstatSync(file);if(capture.schemaVersion===3)referenceCheck(!stat.isSymbolicLink()&&stat.isFile()&&stat.nlink===1&&(typeof process.getuid!=='function'||stat.uid===process.getuid())&&stat.size===entry.bytes,'raw namespace identity mismatch');const bytes=readAbsolute(file);referenceCheck(bytes.length===entry.bytes&&digest(bytes)===entry.sha256,'exact declared raw bytes/hash required: '+entry.path);return visit(bytes);};
  return capture.events.includes(entry)||(capture.orphans||[]).includes(entry)?lease('event',3,load):load();
 };
 const access={
  physicalSize:physicalKeys.size,physicalKeys:()=>physicalKeys.values(),withPhysical:rawBytes,
  withEvent:(event,visit)=>{referenceCheck(event&&capture.events[event.index-1]===event,'canonical event address required');return rawBytes(event,bytes=>lease('parsed',4,()=>{audit[1]++;const delivery=JSON.parse(bytes.toString('utf8')),index=startupNodeIndex(delivery);referenceCheck(index.nodes.length<=bytes.length,'bounded canonical node index required');return visit(delivery,index);}));},
  withSource:(ordinal,visit)=>lease('source',5,()=>{const source=spec.sources?.[ordinal];referenceCheck(source,'source ordinal required');const bytes=readOwned(source.path);audit[2]++;referenceCheck(bytes.length<=33554432&&digest(bytes)===source.sha256,'unique retained source URL/bytes/hash required');return visit(bytes);}),
  withPNG:(encoded,visit)=>lease('png',6,()=>visit(Buffer.from(encoded.slice('data:image/png;base64,'.length),'base64'))),
  assertClosed:()=>referenceCheck(Object.values(active).every(n=>n===0),'outstanding owned leases at return')
 };
 access.withFramePNG=(frame,visit)=>canonical?access.withEvent(capture.events[frame.eventIndex-1],delivery=>{let record=delivery.record;for(const i of frame.recordPath)record=record.children[i];return access.withPNG(record.data.imageData,visit);}):rawBytes(frame,visit);
 const state={plan:{branch:0,status:0,clock:0,flags:0,refs:[],records:[],work:[],stacks:[],anchors:[],snapshots:[],observations:[[0,null,null],[1,null,null],[2,null,null]],gaps:[],audit},recordFacts:[],workFacts:[],stackFacts:[],snapshotFacts:[],sourceLengths,recordByPath:new Map(),native:null,ordinary:null,currentIndex:null};
 const metaRef=(kind,...keys)=>{const ordinal=metadata[kind].path(...keys);return ordinal===undefined?undefined:referenceValue(['a',kind,0,ordinal]);};
 const ctx={root,spec,report,capture,metadata,inputSet,implementation,state,access,verifyMetadata,verifyImplementation,metaRef};
 const refSlots=[[2,'startupObservation'],[0,'producer'],[0,'appBinding','sourceManifest'],[0,'appBinding','custodyReadbacks',0],[0,'appBinding','actionReceipts',0],[0,'appBinding','actionReceipts',1],[3,'documents',0],[0,'appBinding','frameAnnotations'],[0,'appBinding'],[3,'facts','calibration'],[0,'sources'],[3]];
 state.plan.refs=refSlots.map(([kind,...keys])=>{const ref=metaRef(kind,...keys);return ref?ref.ref.slice(1):null;});
 const reference={
  sourceLengths,sourceLength:(i,n)=>{sourceLengths[i]=n;},
  beginEvent:(_event,index)=>{referenceCheck(!state.currentIndex,'one current canonical index required');state.currentIndex=index;},endEvent:()=>{state.currentIndex=null;},
  record:(record,recordPath,parent,event)=>{
   const i=state.recordFacts.length,parentIndex=parent?state.recordByPath.get(event.index+':'+JSON.stringify(parent.recordPath)):null;
   referenceCheck(!parent||Number.isSafeInteger(parentIndex),'actual parent record required');const node=state.currentIndex.objects.get(record);referenceCheck(Number.isSafeInteger(node),'actual canonical record node required');
   const fact={recordIndex:i,eventIndex:event.index,childPosition:recordPath.at(-1)??null,parentIndex,type:['FunctionCall','EvaluateScript','Screenshot','TimeStamp','Composite'].includes(record.type)?record.type:null,startSeconds:record.startTime,endSeconds:record.endTime??null,sessionId:event.sessionId,epoch:event.epoch};
   state.plan.records.push([event.index,node,parentIndex]);state.recordFacts.push(fact);state.recordByPath.set(event.index+':'+JSON.stringify(recordPath),i);return fact;
  },
  stack:row=>{state.plan.stacks.push(row.recordIndex);state.stackFacts.push(row.recordIndex);return{recordIndex:row.recordIndex};},
  work:(record,row,bound,fields)=>{
   const url=record.data[fields[0]],manifest=spec.appBinding?.sourceManifest,roleCode=url===manifest?.documentURL+'landscape.js'?1:manifest?.generated?.some(x=>x.url===url)||manifest?.sdk?.some(x=>x.url===url)?2:0;
   const fact={recordIndex:row.recordIndex,sourceOrdinal:bound?.ordinal??null,sourceBinding:{status:bound?'bound':url?'unbound':'unlocated'},roleCode,startSeconds:record.startTime,endSeconds:record.endTime};state.plan.work.push([row.recordIndex,bound?.ordinal??null,0,0]);state.workFacts.push(fact);return fact;
  },
  anchor:(row,anchor,identity,prefix,document)=>{
   state.plan.anchors.push(row.recordIndex);const bounded=capture.facts.calibration.status==='bounded',merged={...identity,...anchor};return{phase:anchor.phase,documentId:bounded?anchor.documentId:null,pageMs:anchor.pageMs,sessionId:bounded?merged.sessionId:null,epoch:bounded?merged.epoch:null,prefix:bounded?prefix:null,nativeSeconds:row.startSeconds,contextId:document?.contextId??null};
  },
  findRecord:(eventIndex,recordPath)=>state.recordFacts[state.recordByPath.get(eventIndex+':'+JSON.stringify(recordPath))],
  snapshot:(frame,ordinal,row,session,document,pageInterval)=>{
   state.plan.snapshots.push([ordinal,row.recordIndex]);const fact={index:frame.index,path:frame.path,sha256:frame.sha256,eventIndex:frame.eventIndex,recordPath:frame.recordPath,sessionId:frame.sessionId,startSeconds:frame.startSeconds,endSeconds:frame.endSeconds,epoch:session.epoch,pageInterval,documentAssociation:document?'sole-owned-document-session-epoch':'unbound-native-prefix',recordIndex:row.recordIndex};state.snapshotFacts.push(fact);return fact;
  },
  nativeResult:(native,truncated)=>{state.native=native;state.plan.clock=native.clock.status==='bounded'?1:0;state.plan.flags=truncated?1:0;},
  finishPartial:()=>{state.plan.gaps=[0,1,2,3,4,5,6,14];return finish();},
  finishOrdinary:ordinary=>{
   state.ordinary=ordinary;state.plan.branch=1;state.plan.status=ordinary.control?1:Object.values(ordinary.observations).some(x=>x.status!=='observed')?0:2;
   if(spec.appBinding.frameAnnotations?.status==='unreviewed')state.plan.flags|=2;
   state.plan.gaps=[0,1,2,3,4,5,6,...ordinary.gaps.map(g=>REFERENCE_GAPS.indexOf(g))];
   for(const [i,work]of ordinary.workIntervals.entries()){state.plan.work[i][2]=['unclassified','optional','instrumentation'].indexOf(work.role);state.plan.work[i][3]=['unavailable','definite','possible','none'].indexOf(work.observedSeparationOverlap);}
   for(const [i,name]of ['firstObservedBackground','firstObservedSafeBoard','firstObservedVisibleResponse'].entries()){const observation=ordinary.observations[name];if(observation.status==='observed'){const ordinal=capture.frames.findIndex(f=>f.path===observation.framePath),annotation=spec.appBinding.frameAnnotations.states.indexOf(observation.annotation);state.plan.observations[i]=[i,ordinal,metadata[0].path('appBinding','frameAnnotations','states',annotation)];}}
   return finish();
  }
 };
 function finish(){access.assertClosed();referenceCheck(!state.currentIndex,'closed canonical index required');state.plan.audit=[...audit];const manifest={schemaVersion:1,view:'canonical-reference-v1',inputSet,implementation,root:['d',0,0],plan:state.plan};validateStartupReferenceManifest(manifest);referenceCheck(Buffer.byteLength(JSON.stringify(manifest))+1<=2690817,'compact serialization bound exceeded');return manifest;}
 const nativeInputs={retentionProfile,captureBytes:buffers[3],expectedCaptureSha256:spec.captureSha256,rawInventoryBytes:buffers[4],sources:spec.sources,producer:spec.producer,consumer:{kind:'explicit-diagnostic-verification',modules:REFERENCE_MODULES.map((file,i)=>({path:file,sha256:implementation[i]}))},appBinding:{...spec.appBinding,fixtureBytes:buffers[5]},access,reference};
 ctx.manifest=classifyButtonStartupTimeline(report.startupObservation,capture,nativeInputs);access.assertClosed();
 // Only metadata, bounded scalar/ID facts, and byte-access functions remain.
 return ctx;
}

function validateStartupReferenceManifest(view){
 const integer=(n,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const keys=(value,names)=>referenceCheck(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).join('\0')===names.join('\0'),'fixed manifest schema required');
 const tuple=(value,length)=>Array.isArray(value)&&value.length===length;
 const table=(rows,max,check)=>{referenceCheck(Array.isArray(rows)&&rows.length<=max,'bounded manifest table required');for(const row of rows)referenceCheck(check(row),'valid manifest tuple required');};
 keys(view,['schemaVersion','view','inputSet','implementation','root','plan']);referenceCheck(view.schemaVersion===1&&view.view==='canonical-reference-v1'&&JSON.stringify(view.root)==='["d",0,0]','known manifest view/root required');
 referenceCheck(Array.isArray(view.inputSet)&&view.inputSet.length===6&&view.inputSet.every(r=>tuple(r,2)&&/^[a-f0-9]{64}$/.test(r[0])&&integer(r[1])),'six exact manifest inputs required');
 referenceCheck(Array.isArray(view.implementation)&&view.implementation.length===4&&view.implementation.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)),'four actual implementation hashes required');
 const p=view.plan;keys(p,['branch','status','clock','flags','refs','records','work','stacks','anchors','snapshots','observations','gaps','audit']);
 referenceCheck(integer(p.branch,1)&&integer(p.status,2)&&integer(p.clock,1)&&integer(p.flags,3),'fixed plan enums required');
 referenceCheck(Array.isArray(p.refs)&&p.refs.length===12&&p.refs.every(r=>r===null||tuple(r,3)&&integer(r[0],5)&&r[1]===0&&integer(r[2])),'fixed metadata reference slots required');
 table(p.records,16384,r=>tuple(r,3)&&integer(r[0],4096)&&r[0]>0&&integer(r[1],1048576)&&(r[2]===null||integer(r[2],16383)));
 table(p.work,16384,r=>tuple(r,4)&&integer(r[0],16383)&&(r[1]===null||integer(r[1]))&&integer(r[2],2)&&integer(r[3],3));
 table(p.stacks,16384,r=>integer(r,16383));table(p.anchors,16384,r=>integer(r,16383));table(p.snapshots,120,r=>tuple(r,2)&&integer(r[0],119)&&integer(r[1],16383));
 referenceCheck(Array.isArray(p.observations)&&p.observations.length===3&&p.observations.every((r,i)=>tuple(r,3)&&r[0]===i&&(r[1]===null||integer(r[1],119))&&(r[2]===null||integer(r[2]))),'three bounded observation selections required');
 table(p.gaps,16,r=>integer(r,31));referenceCheck(Array.isArray(p.audit)&&p.audit.length===7&&p.audit.every(n=>integer(n))&&p.audit.slice(3).every(n=>n<=1),'actual bounded construction audit required');
 return view;
}

const STARTUP_KEY_REFS=Symbol('canonical property key references');
function startupArtifactSpread(index,ordinal,prefix){
 const node=index.nodes[ordinal];referenceCheck(node?.keys,'object spread source required');const value=Object.create(null),keys=new Map();
 for(const [i,key]of node.keys.entries()){ownReferenceValue(value,key,referenceValue([...prefix,node.children[i][1]]));keys.set(key,[...prefix,node.children[i][0]]);}
 Object.defineProperty(value,STARTUP_KEY_REFS,{value:keys});return value;
}
function startupOverlay(value,fields){for(const key of Object.keys(fields))ownReferenceValue(value,key,fields[key]);return value;}
function startupRecordPath(ctx,index){
 const path=[];let fact=ctx.state.recordFacts[index];referenceCheck(fact,'actual record index required');
 while(fact.parentIndex!==null){referenceCheck(path.length<64,'actual record path bound');path.push(fact.childPosition);fact=ctx.state.recordFacts[fact.parentIndex];referenceCheck(fact,'actual structural parent required');}
 return path.reverse();
}
function startupWithRecord(ctx,index,visit){
 const row=ctx.state.plan.records[index];referenceCheck(row,'actual record index required');ctx.verifyMetadata(3);ctx.verifyMetadata(4);
 return ctx.access.withEvent(ctx.capture.events[row[0]-1],(_delivery,nodes)=>{const node=nodes.nodes[row[1]],record=node?.value;referenceCheck(record&&typeof record==='object'&&!Array.isArray(record)&&typeof record.type==='string','actual record node required');
  const field=(...keys)=>{let n=row[1];for(const key of keys){n=nodes.child(n,key);if(n===undefined)return undefined;}return referenceValue(['a',6,row[0],n]);};
  return visit(record,field,nodes,ctx.capture.events[row[0]-1]);
 });
}
function startupWithAnchor(ctx,recordIndex,visit){
 return startupWithRecord(ctx,recordIndex,(record,field,nodes,event)=>{
  referenceCheck(record.type==='TimeStamp'&&typeof record.data.message==='string','anchor record required');const match=/^(native-timeline:[^:]+:)(\{.*\})$/.exec(record.data.message);referenceCheck(match,'native anchor projection required');const payload=JSON.parse(match[2]),index=startupNodeIndex(payload);referenceCheck(payload&&typeof payload==='object'&&!Array.isArray(payload),'anchor object required');return visit(payload,index,match[1],record,field,nodes,event);
 });
}
function startupClockDependencies(ctx){
 ctx.verifyMetadata(3);ctx.verifyMetadata(4);const events=new Set(ctx.state.plan.anchors.map(i=>ctx.state.plan.records[i][0]));for(const i of events)ctx.access.withPhysical(ctx.capture.events[i-1],()=>undefined);
}
function startupDerivedChild(kind,index,path,value){
 if(value instanceof StartupValueReference)return value.ref.slice();const slot=REFERENCE_SLOTS[kind].indexOf(path);referenceCheck(slot>0,'realized static recipe slot required: '+kind+'/'+path);return['d',kind,index,slot];
}
function startupRecipeSpread(ctx,kind,index){
 const source=startupRecipe(ctx,kind,index),target=Object.create(null),keys=new Map();
 for(const key of Object.keys(source)){if(source[key]===undefined)continue;ownReferenceValue(target,key,referenceValue(startupDerivedChild(kind,index,key,source[key])));const keyRef=source[STARTUP_KEY_REFS]?.get(key);if(keyRef)keys.set(key,keyRef.slice());}
 Object.defineProperty(target,STARTUP_KEY_REFS,{value:keys});return target;
}

function startupRecipe(ctx,kind,index){
 const {state,capture,metaRef}=ctx,p=state.plan,native=state.native,document=capture.documents[0]||null,session=capture.sessions[0];
 const identity=(recordIndex,event)=>({eventIndex:event.index,recordPath:derivedReference(28,recordIndex),sessionId:event.sessionId,epoch:event.epoch});
 const parentReference=i=>p.records[i][2]===null?null:derivedReference(3,i);
 switch(kind){
  case 0:{
   ctx.verifyMetadata(2);
   if(p.branch===0)return{status:'incomplete',ordinaryRouteEligible:false,nativeEvidence:derivedReference(1),gaps:derivedReference(20,1)};
   ctx.verifyMetadata(0);const timeline=ctx.metadata[2].path('startupObservation'),value=startupArtifactSpread(ctx.metadata[2],timeline,['a',2,0]);
   return startupOverlay(value,{observedBackgroundToBoardSeparation:derivedReference(16),status:['incomplete','control-only','bounded-observations'][p.status],evidenceKind:metaRef(0,'appBinding','evidenceKind'),ordinaryRouteEligible:false,requiresRootDecision:true,nativeEvidence:derivedReference(1),sourceManifest:metaRef(0,'appBinding','sourceManifest'),trustedInput:derivedReference(15),custody:derivedReference(14),observations:derivedReference(12),workIntervals:derivedReference(27),gaps:derivedReference(20,2),producer:metaRef(0,'producer'),consumer:derivedReference(11)});
  }
  case 1:ctx.verifyMetadata(3);return{schemaVersion:1,status:p.branch===0?'incomplete':'derived-bounded-observations',producer:metaRef(0,'producer'),consumer:derivedReference(11),inputDigests:derivedReference(19),policy:derivedReference(17),records:derivedReference(21),workScopes:derivedReference(22),stackObservations:derivedReference(23),clock:derivedReference(8),snapshots:derivedReference(25),coverage:derivedReference(18),gaps:derivedReference(20,0)};
  case 2:return startupWithRecord(ctx,index,(record,field,_nodes,event)=>({...identity(index,event),type:field('type'),startSeconds:field('startTime'),endSeconds:record.endTime??null,parent:parentReference(index),data:field('data'),pageInterval:derivedReference(13,index)}));
  case 3:{const parent=p.records[index][2];referenceCheck(parent!==null,'actual parent association required');return startupWithRecord(ctx,parent,(_record,field,_nodes,event)=>({eventIndex:event.index,recordPath:derivedReference(30,index),type:field('type'),data:field('data')}));}
  case 4:{const fact=state.workFacts[index];return startupWithRecord(ctx,fact.recordIndex,(record,field,_nodes,event)=>{const fields=record.type==='FunctionCall'?['scriptName','scriptLine','scriptColumn']:['url','lineNumber','columnNumber'];return{...identity(fact.recordIndex,event),parent:parentReference(fact.recordIndex),type:field('type'),kind:'instrumented-sync-scope',startSeconds:field('startTime'),endSeconds:field('endTime'),durationMs:1000*(record.endTime-record.startTime),callerIdentity:{url:field('data',fields[0]),line:field('data',fields[1]),column:field('data',fields[2]),coordinateKind:record.type==='FunctionCall'?'function-call':'evaluate-script',coordinateBasis:'native-verbatim; base-unestablished'},sourceBinding:derivedReference(29,index),name:null,nameStatus:'unavailable',requiredOrOptional:'unclassified',cpuUsage:'unmeasured',pageInterval:derivedReference(13,fact.recordIndex)};});}
  case 5:{const recordIndex=p.stacks[index];return startupWithRecord(ctx,recordIndex,(_record,field,_nodes,event)=>({...identity(recordIndex,event),type:field('type'),atSeconds:field('startTime'),stackTrace:field('stackTrace'),durationAttribution:false,association:'this-native-record-only'}));}
  case 6:{
   ctx.verifyMetadata(3);const [frameOrdinal,recordIndex]=p.snapshots[index],frameNode=ctx.metadata[3].path('frames',frameOrdinal),parent=p.records[recordIndex][2],value=startupArtifactSpread(ctx.metadata[3],frameNode,['a',3,0]);
   return startupOverlay(value,{epoch:metaRef(3,'sessions',0,'epoch'),parent:parentReference(recordIndex),compositeParent:parent!==null&&state.recordFacts[parent].type==='Composite'?derivedReference(3,recordIndex):null,pageInterval:derivedReference(13,recordIndex),documentAssociation:document?'sole-owned-document-session-epoch':'unbound-native-prefix',documentId:document?metaRef(3,'documents',0,'id'):null,nativeDocumentId:null,nativeContextId:null,firstOccurrence:'unverified',presentation:'engine-main-frame-content-snapshot',limit:'No per-image native document/context tag, OS display fence or every-frame guarantee'});
  }
  case 7:{const recordIndex=p.anchors[index];return startupWithAnchor(ctx,recordIndex,(_payload,nodes,prefix,_record,field,_eventNodes,event)=>{
   const value=Object.create(null),keyRefs=new Map();Object.defineProperty(value,STARTUP_KEY_REFS,{value:keyRefs});startupOverlay(value,identity(recordIndex,event));const payload=startupArtifactSpread(nodes,0,['j',recordIndex]);
   for(const key of Object.keys(payload)){ownReferenceValue(value,key,payload[key]);keyRefs.set(key,payload[STARTUP_KEY_REFS].get(key));}
   return startupOverlay(value,{prefix,nativeSeconds:field('startTime'),contextId:document?metaRef(3,'documents',0,'contextId')??null:null});
  });}
  case 8:{startupClockDependencies(ctx);const clock={...native.clock,anchors:derivedReference(24)};if(clock.status==='bounded'){clock.document=metaRef(3,'documents',0);clock.sessionId=metaRef(3,'sessions',0,'id');clock.epoch=metaRef(3,'sessions',0,'epoch');}return clock;}
  case 9:return startupOverlay(startupRecipeSpread(ctx,4,index),{role:['unclassified','optional','instrumentation'][p.work[index][2]],observedSeparationOverlap:['unavailable','definite','possible','none'][p.work[index][3]],causation:'unproved'});
  case 10:ctx.verifyMetadata(0);return ctx.access.withSource(index,bytes=>({url:metaRef(0,'sources',index,'url'),sha256:metaRef(0,'sources',index,'sha256'),bytes:bytes.length}));
  case 11:return{kind:'explicit-diagnostic-verification',modules:REFERENCE_MODULES.map((file,i)=>({path:file,sha256:ctx.implementation[i]}))};
  case 12:{
   referenceCheck(state.ordinary,'ordinary observation recipe required');ctx.verifyMetadata(0);startupClockDependencies(ctx);const observations={};
   for(const [i,name]of ['firstObservedBackground','firstObservedSafeBoard','firstObservedVisibleResponse'].entries()){
    const source=state.ordinary.observations[name],[,ordinal,annotation]=p.observations[i];
    if(source.status!=='observed'){observations[name]={status:source.status,reason:source.reason};continue;}
    const frame=capture.frames[ordinal];observations[name]={status:'observed',nativeInterval:[frame.startSeconds,frame.endSeconds],pageInterval:{...source.pageInterval},framePath:metaRef(3,'frames',ordinal,'path'),frameSha256:metaRef(3,'frames',ordinal,'sha256'),eventIndex:metaRef(3,'frames',ordinal,'eventIndex'),recordPath:metaRef(3,'frames',ordinal,'recordPath'),documentId:metaRef(3,'documents',0,'id'),sessionId:metaRef(3,'frames',ordinal,'sessionId'),epoch:metaRef(3,'sessions',0,'epoch'),nativeContextId:null,documentAssociation:source.documentAssociation,firstOccurrence:'unverified',annotation:referenceValue(['a',0,0,annotation]),interactivity:'not-established-by-pixels'};
   }
   observations.firstTrustedInputReceipt={status:'observed',atMs:metaRef(0,'appBinding','actionReceipts',0,'pageMs'),basis:'Trusted page listener matched to exact native TimeStamp',trusted:true,operationId:metaRef(0,'appBinding','actionReceipts',0,'operationId')};return observations;
  }
  case 13:startupClockDependencies(ctx);return startupWithRecord(ctx,index,()=>({...state.recordFacts[index].pageInterval}));
  case 14:referenceCheck(state.ordinary,'ordinary custody recipe required');ctx.verifyMetadata(0);return{tasks:64,unknownOpaqueCodeUnits:1048576,postActionAddOpen:false,readback:metaRef(0,'appBinding','custodyReadbacks',0),allTypedStoresRetained:true};
  case 15:referenceCheck(state.ordinary,'ordinary input recipe required');ctx.verifyMetadata(0);return{operationId:metaRef(0,'appBinding','actionReceipts',0,'operationId'),pointerdown:metaRef(0,'appBinding','actionReceipts',0),click:metaRef(0,'appBinding','actionReceipts',1)};
  case 16:referenceCheck(state.ordinary,'ordinary separation recipe required');ctx.verifyMetadata(0);startupClockDependencies(ctx);return{...state.ordinary.separation};
  case 17:ctx.verifyMetadata(3);return{...native.policy};
  case 18:ctx.verifyMetadata(3);ctx.verifyMetadata(4);return{...native.coverage};
  case 19:ctx.verifyMetadata(3);ctx.verifyMetadata(4);return{captureSha256:ctx.inputSet[3][0],rawInventorySha256:ctx.inputSet[4][0],sources:derivedReference(26)};
  case 29:{
   const fact=state.workFacts[index];ctx.verifyMetadata(0);return startupWithRecord(ctx,fact.recordIndex,(record,field)=>{const key=record.type==='FunctionCall'?'scriptName':'url';if(fact.sourceOrdinal===null)return{status:record.data[key]?'unbound':'unlocated',url:field('data',key)};
    return ctx.access.withSource(fact.sourceOrdinal,bytes=>({status:'bound',url:field('data',key),sha256:metaRef(0,'sources',fact.sourceOrdinal,'sha256'),bytes:bytes.length,kind:ctx.spec.sources[fact.sourceOrdinal].kind?metaRef(0,'sources',fact.sourceOrdinal,'kind'):'unspecified'}));
   });
  }
  default:referenceCheck(false,'undefined derived recipe');
 }
}

function startupValidateAddress(ctx,ref){
 referenceCheck(Array.isArray(ref),'reference tuple required');const integer=n=>Number.isSafeInteger(n)&&n>=0;
 if(ref[0]==='l'){referenceCheck(ref.length===2&&integer(ref[1])&&ref[1]<REFERENCE_LITERALS.length,'literal address required');return;}
 if(ref[0]==='a'){referenceCheck(ref.length===4&&integer(ref[1])&&ref[1]<=6&&integer(ref[2])&&integer(ref[3])&&(ref[1]===6?ref[2]>=1&&ref[2]<=ctx.capture.events.length&&ref[3]<=1048576:ref[2]===0),'artifact address required');return;}
 if(ref[0]==='j'){referenceCheck(ref.length===3&&integer(ref[1])&&ref[1]<ctx.state.plan.records.length&&integer(ref[2])&&ref[2]<=1048576&&ctx.state.plan.anchors.includes(ref[1]),'actual anchor projection address required');return;}
 referenceCheck(ref[0]==='d'&&(ref.length===3||ref.length===4)&&integer(ref[1])&&ref[1]<=30&&integer(ref[2])&&(ref.length===3||integer(ref[3])&&ref[3]<=127),'derived address required');
 const [,kind,index]=ref,p=ctx.state.plan,limit=[1,1,p.records.length,p.records.length,p.work.length,p.stacks.length,p.snapshots.length,p.anchors.length,1,p.work.length,ctx.spec.sources.length,1,1,p.records.length,1,1,1,1,1,1,3,1,1,1,1,1,1,1,p.records.length,p.work.length,p.records.length][kind];
 referenceCheck(index<limit,'derived index required');if([3,30].includes(kind))referenceCheck(p.records[index][2]!==null,'actual parent association required');
 referenceCheck((ref[3]??0)<REFERENCE_SLOTS[kind].length,'defined recipe slot required');
}

function startupReferenceDispatch(ctx,ref,operation,position=0){
 startupValidateAddress(ctx,ref);const tag=ref[0];
 const describe=(value,children,keys=null)=>{
  if(value===null||typeof value!=='object'){
   referenceCheck(operation==='describe','primitive has no iterator');referenceCheck(value!==undefined,'serialized value required');return{kind:'primitive',value:typeof value==='number'?Number.isFinite(value)?Object.is(value,-0)?0:value:null:value};
  }
  const array=Array.isArray(value),length=array?value.length:keys.length;
  if(operation==='describe')return{kind:array?'array':'object',length};
  referenceCheck(operation===(array?'item':'entry'),'matching descriptor iterator required');return position<length?children(position):null;
 };
 const indexed=(index,ordinal,prefix)=>{
  const node=index.nodes[ordinal];referenceCheck(node,'existing canonical node required');
  return describe(node.value,i=>node.array?[...prefix,node.children[i]]:[[...prefix,node.children[i][0]],[...prefix,node.children[i][1]]],node.keys??null);
 };
 if(tag==='l')return describe(REFERENCE_LITERALS[ref[1]],null);
 if(tag==='a'){
  const [,kind,ordinal,node]=ref;if(kind<6){ctx.verifyMetadata(kind);return indexed(ctx.metadata[kind],node,['a',kind,0]);}
  ctx.verifyMetadata(3);ctx.verifyMetadata(4);return ctx.access.withEvent(ctx.capture.events[ordinal-1],(_delivery,index)=>indexed(index,node,['a',6,ordinal]));
 }
 if(tag==='j')return startupWithAnchor(ctx,ref[1],(_payload,index)=>indexed(index,ref[2],['j',ref[1]]));
 const [,kind,index]=ref,slot=ref[3]??0;
 if(kind===20){ctx.verifyMetadata(3);const ids=index===0?[0,1,2,3,4,5,6]:index===1?[14]:ctx.state.plan.gaps.filter(n=>n>=7&&n<=13);referenceCheck(index!==1||ctx.state.plan.branch===0,'partial-root gap recipe required');referenceCheck(index!==2||ctx.state.ordinary,'ordinary gap recipe required');if(slot){referenceCheck(slot<=ids.length,'existing gap item required');return describe(REFERENCE_GAPS[ids[slot-1]],null);}return describe(ids,i=>['l',REFERENCE_LITERALS.indexOf(REFERENCE_GAPS[ids[i]])]);}
 if(kind>=21&&kind<=27){
  referenceCheck(slot===0,'array root slot required');const lengths=[ctx.state.plan.records.length,ctx.state.plan.work.length,ctx.state.plan.stacks.length,ctx.state.plan.anchors.length,ctx.state.plan.snapshots.length,ctx.spec.sources.length,ctx.state.plan.work.length],targets=[2,4,5,7,6,10,9];
  if(kind===26)ctx.verifyMetadata(0);else{ctx.verifyMetadata(3);ctx.verifyMetadata(4);}
  if(kind===27)referenceCheck(ctx.state.ordinary,'ordinary work array required');
  if(operation==='describe'){if(kind!==26)for(const event of ctx.capture.events)ctx.access.withPhysical(event,()=>undefined);return{kind:'array',length:lengths[kind-21]};}
  referenceCheck(operation==='item','array iterator required');return position<lengths[kind-21]?['d',targets[kind-21],position]:null;
 }
 if(kind===28||kind===30){const recordIndex=kind===28?index:ctx.state.plan.records[index][2];return startupWithRecord(ctx,recordIndex,()=>{const value=startupRecordPath(ctx,recordIndex);if(slot){referenceCheck(slot<=value.length,'existing record path item required');return describe(value[slot-1],null);}return describe(value,i=>['d',kind,index,i+1]);});}
 const root=startupRecipe(ctx,kind,index),path=REFERENCE_SLOTS[kind][slot];let value=root;
 if(slot)for(const part of path.split('.')){referenceCheck(value&&typeof value==='object'&&!(value instanceof StartupValueReference)&&Object.hasOwn(value,part),'existing recipe subnode required');value=value[part];}
 if(value instanceof StartupValueReference)return startupReferenceDispatch(ctx,value.ref,operation,position);
 const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).filter(k=>value[k]!==undefined):null;
 return describe(value,i=>{
  const array=Array.isArray(value),key=array?String(i):keys[i],child=value[key],childPath=path?path+'.'+key:key,childRef=startupDerivedChild(kind,index,childPath,child);
  if(array)return childRef;const keyRef=value[STARTUP_KEY_REFS]?.get(key),literal=REFERENCE_LITERALS.indexOf(key);referenceCheck(keyRef||literal>=0,'fixed or canonical property-key address required');return[keyRef?.slice()??['l',literal],childRef];
 },keys);
}

export function openButtonStartupTimelineReference(view,context){
 validateStartupReferenceManifest(view);const ctx=startupReferenceContext(context);referenceCheck(JSON.stringify(view)===JSON.stringify(ctx.manifest),'canonical manifest binding mismatch');
 const dispatch=(ref,operation,position)=>{ctx.verifyImplementation();const result=startupReferenceDispatch(ctx,ref,operation,position);ctx.access.assertClosed();return result;};
 const iterator=(ref,operation)=>{let position=0;return{next(){const value=dispatch(ref,operation,position);if(value===null)return{done:true,value:undefined};position++;return{done:false,value};},[Symbol.iterator](){return this;}};};
 return{root:['d',0,0],read(reference){startupValidateAddress(ctx,reference);const ref=reference.slice(),description=dispatch(ref,'describe');if(description.kind==='primitive')return description;if(description.kind==='array')return{kind:'array',length:description.length,items:iterator(ref,'item')};return{kind:'object',entries:iterator(ref,'entry')};}};
}
// Diagnostic timing is independent of the application's functional verdict.
export function verifyButtonStartupCapture(capture,{retentionProfile}={}){
 if(capture?.provider==='webkit-native-timeline')return verifyNativeTimelineCapture(capture,{retentionProfile});
 const check=(condition,message)=>assert.ok(condition,'Startup capture '+message),finite=value=>Number.isFinite(value)&&value>=0;
 check(capture?.schemaVersion===1&&capture.selected===true&&capture.provider==='playwright-public-screencast','known selected public provider required');
 check(JSON.stringify(capture.bounds)===JSON.stringify({maxDurationMs:12000,maxFrames:120,maxTotalBytes:8388608,maxFrameBytes:262144}),'fixed finite bounds required');
 check(['captured','unavailable','error'].includes(capture.status),'explicit outcome required');check(capture.startedBeforeNavigation===true,'must start before app navigation');
 check(finite(capture.startedHostMonotonicMs)&&finite(capture.stoppedHostMonotonicMs)&&capture.stoppedHostMonotonicMs>=capture.startedHostMonotonicMs&&capture.stoppedHostMonotonicMs-capture.startedHostMonotonicMs<=12000,'duration exceeds bound or mixes clocks');
 check(capture.clock?.reportedTimestampBasis==='engine-or-Date.now-fallback-ambiguous'&&capture.clock.hostEpochBasis==='Date.now'&&capture.clock.hostMonotonicBasis==='performance.now'&&capture.clock.pageClockConversion==='unavailable','reported/host/page clocks must remain distinct and ambiguous');
 const frames=capture.frames,counts=capture.counts;check(Array.isArray(frames)&&frames.length<=120,'accepted frame limit');check(counts&&['received','accepted','dropped','oversized','writeRefused'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0),'bounded explicit counters');check(counts.accepted===frames.length&&counts.received===counts.accepted+counts.dropped+counts.oversized+counts.writeRefused,'frame counts must reconcile');
 const paths=new Set();let total=0;
 for(const [index,frame]of frames.entries()){
  check(frame.index===index+1&&/^startup-frames\/frame-[0-9]{4}\.jpg$/.test(frame.path)&&!paths.has(frame.path),'relative unique JPEG path/index required');paths.add(frame.path);
  check(Number.isSafeInteger(frame.bytes)&&frame.bytes>0&&frame.bytes<=262144,'per-frame byte limit');total+=frame.bytes;check(/^[a-f0-9]{64}$/.test(frame.sha256||''),'SHA256 required');
  check([frame.reportedTimestampMs,frame.hostReceiptEpochMs,frame.hostReceiptMonotonicMs].every(finite)&&frame.hostReceiptMonotonicMs>=capture.startedHostMonotonicMs&&frame.hostReceiptMonotonicMs<=capture.stoppedHostMonotonicMs,'separate finite frame clocks required');
  check(frame.viewportWidth===1100&&frame.viewportHeight===850,'original capture viewport required');
  check(frame.pageClockSample?.status==='unavailable'||frame.pageClockSample?.status==='observed'&&finite(frame.pageClockSample.timeOrigin)&&finite(frame.pageClockSample.nowMs)&&frame.pageClockSample.basis==='post-callback-receipt-upper-bound','page sample cannot claim compositor timing');
 }
 check(total===capture.totalBytes&&total<=8388608,'total byte/count mismatch');check(typeof capture.stopReason==='string'&&capture.stopReason.length>0,'explicit stop reason required');check(capture.cleanup?.stopAttempted===true&&capture.cleanup.stopped===true&&capture.cleanup.timerCleared===true,'owned stop and timer cleanup required');
 check(Array.isArray(capture.errors),'explicit capture errors required');if(capture.status==='captured')check(frames.length>0&&capture.errors.length===0,'captured requires real accepted frames without error');return capture;
}
export function classifyButtonStartupTimeline(timeline,capture=null,nativeInputs=null){
 if(nativeInputs?.evidenceView!==undefined){assert.equal(nativeInputs.evidenceView,'canonical-reference-v1','Unknown startup evidence view');return startupReferenceContext(nativeInputs).manifest;}
 if(timeline?.schemaVersion===2||nativeInputs?.appBinding){const nativeEvidence=deriveNativeTimelineEvidence({...nativeInputs,capture});if(nativeEvidence.status==='incomplete')return nativeInputs?.reference?nativeInputs.reference.finishPartial():{status:'incomplete',ordinaryRouteEligible:false,nativeEvidence,gaps:['Partial native prefix cannot establish ordinary startup clock/input/custody or completed capture']};return deriveOrdinaryStartupObservation(timeline,capture,nativeInputs,nativeEvidence);}
 const names=['navigationStart','firstBackgroundPaint','completeBoardPaint','firstTrustedInputReceipt','firstVisibleResponse','overlappingWorkIntervals'];
 const observations=timeline?.observations||{},missing=[];
 const clockValid=timeline?.schemaVersion===1&&timeline.clock?.basis==='page-performance'&&Number.isFinite(timeline.clock.timeOrigin);
 for(const name of names){
  const row=observations[name];let valid=clockValid&&row?.status==='observed'&&typeof row.basis==='string'&&row.basis.length>0;
  if(name==='overlappingWorkIntervals')valid=valid&&Array.isArray(row.intervals)&&row.intervals.every(interval=>typeof interval.name==='string'&&typeof interval.caller==='string'&&['sync','async-wall'].includes(interval.kind)&&Number.isFinite(interval.startMs)&&interval.startMs>=0&&Number.isFinite(interval.endMs)&&interval.endMs>=interval.startMs);
  else valid=valid&&Number.isFinite(row.atMs)&&row.atMs>=0;
  if(!valid)missing.push(name);
 }
 if(!missing.length){const times=names.slice(0,5).map(name=>observations[name].atMs);if(times[0]!==0||times.some((value,index)=>index>0&&value<times[index-1]))missing.push('ordered-page-clock');}
 if(capture){verifyButtonStartupCapture(capture,{retentionProfile:nativeInputs?.retentionProfile});missing.push('supplemental-clock-and-work-provenance');}
 const nativeEvidence=nativeInputs?deriveNativeTimelineEvidence({...nativeInputs,capture}):null;
 assert.ok(!timeline?.nativeEvidence||nativeEvidence,'Native Timeline derived claim requires its raw inputs');
 return{...timeline,status:missing.length?'incomplete':'complete',missing,...(nativeEvidence?{nativeEvidence,ordinaryRouteEligible:false}:{})};
}
export function verifyButtonSafetyReport(report,{inventory,inventorySha256,candidateCommit,candidateTree,engine,expectedProfile='ordinary',nativeInputs}={}){
 assert.equal(report.schemaVersion,1,'Known button report schema');
 assert.equal(report.kind,'button-safety','Native button report kind');
 assert.ok(['chromium','webkit'].includes(report.engine),'Named native engine required');
 assert.equal(report.scope,undefined,'Focused diagnostics cannot qualify complete button coverage');
 assert.equal(report.status,'passed','Native button run must pass; unavailable engine cannot pass');
 for(const [key,expected]of Object.entries({candidateCommit,candidateTree,engine,inventorySha256}))if(expected!==undefined)assert.equal(report[key],expected,'Button report '+key+' mismatch');
 for(const key of ['candidateCommit','candidateTree'])assert.match(report[key]||'',/^[a-f0-9]{40}$/,'Exact '+key+' required');
 assert.ok(inventory,'Independent button inventory required');
 const actions=inventory.requiredActions;
 const hasProfiles=Object.hasOwn(inventory,'profiles');let profile=null;
 if(hasProfiles){
  assert.ok(inventory.profiles&&typeof inventory.profiles==='object'&&!Array.isArray(inventory.profiles),'Independent button profile inventory required');
  assert.ok(['ordinary','workload-diagnostic'].includes(expectedProfile)&&Object.hasOwn(inventory.profiles,expectedProfile),'Unknown expected button safety profile');
  profile=inventory.profiles[expectedProfile];assert.ok(profile&&typeof profile==='object'&&!Array.isArray(profile),'Independent button profile definition required');
  assert.equal(report.profile,expectedProfile,'Button report profile mismatch');
  assert.match(report.inventorySha256||'',/^[a-f0-9]{64}$/,'Exact profile inventory identity required');
  assert.match(inventorySha256||'',/^[a-f0-9]{64}$/,'Independent profile inventory hash required');
  assert.equal(report.inventorySha256,inventorySha256,'Button report inventory hash mismatch');
  assert.ok(Array.isArray(profile.requiredScenarios)&&profile.requiredScenarios.length>0,'Independent profile scenario inventory required');
  if(expectedProfile==='ordinary'){
   assert.equal(profile.requiredScenarios.length,60,'All fifty ordinary flows and ten semantic repeats are required');
   assert.deepEqual(profile.fixture,{savedTasks:64,source:'signed-out-installed',authMode:'signed-out'},'Reviewed ordinary signed-out 64-task fixture required');
   assert.ok(Array.isArray(profile.requiredRepeatCases)&&profile.requiredRepeatCases.length===10,'All ten reviewed ordinary repeat cases are required');
  }else{
   assert.equal(profile.requiredScenarios.length,90,'All original workload-diagnostic scenarios are required');
   assert.deepEqual(profile.requiredScenarios,inventory.requiredScenarios,'Original diagnostic scenario inventory must remain intact');
   assert.deepEqual(profile.scenarioRoles,inventory.scenarioRoles,'Original diagnostic fixture roles must remain intact');
   assert.deepEqual(profile.requiredWorkload,{savedTasks:400,rapidAttempts:10,rapidWindowMs:2000},'Original diagnostic workload controls must remain intact');
   assert.deepEqual(profile.requiredWorkload,inventory.requiredWorkload,'Original diagnostic workload controls must remain intact');
   assert.deepEqual(profile.requiredRapidActions,actions,'All original diagnostic rapid action controls are required');
   assert.deepEqual(profile.requiredRapidActions,inventory.requiredRapidActions,'Original diagnostic rapid action inventory must remain intact');
  }
 }else{
  assert.equal(expectedProfile,'ordinary','Profile selection requires an independent profile inventory');
  assert.equal(report.profile,undefined,'A profile label requires an independent profile inventory');
 }
 for(const [file,hash]of Object.entries(inventory.requiredRuntimeAssets||{})){
  assert.match(hash,/^[a-f0-9]{64}$/,'Reviewed runtime asset SHA256 required: '+file);
  assert.equal(report.assets?.[file],hash,'Native runtime asset missing or changed: '+file);
 }
 assert.ok(Array.isArray(actions)&&actions.length>0,'Nonempty independent button inventory required');
 assert.equal(new Set(actions).size,actions.length,'Duplicate expected button action');
 assert.deepEqual(report.requiredActions,actions,'Report cannot waive required actions');
 for(const action of actions){
  const rows=(report.outcomes||[]).filter(row=>row.action===action);
  assert.equal(rows.length,1,'Missing required button action: '+action);
  const row=rows[0];assert.equal(row.status,'passed','Button action must execute successfully: '+action);
  assert.ok(row.events?.includes('click')||row.events?.includes('change')||row.events?.includes('submit'),'Real consumer event required: '+action);
  assert.ok(Number.isSafeInteger(row.assertions)&&row.assertions>0,'Independent outcome assertion required: '+action);
  assert.equal(row.responsive,true,'Button action responsiveness required: '+action);
 }
 assert.equal(report.outcomes.length,actions.length,'Unexpected or duplicate native outcome');
 const scenarios=profile?profile.requiredScenarios:inventory?.requiredScenarios;
 if(scenarios){
  assert.ok(Array.isArray(scenarios)&&scenarios.length>0,'Nonempty independent state scenario inventory required');
  assert.equal(new Set(scenarios).size,scenarios.length,'Duplicate expected native state scenario');
  assert.deepEqual(report.requiredScenarios,scenarios,'Report cannot waive required state scenarios');
  for(const name of scenarios){
   const rows=(report.scenarios||[]).filter(row=>row.name===name);
   assert.equal(rows.length,1,'Missing or duplicate required native state scenario: '+name);
   assert.equal(rows[0].status,'passed','Native state scenario must execute successfully: '+name);
  }
  assert.equal(report.scenarios.length,scenarios.length,'Unexpected native state scenario');
 }

 const workload=profile?profile.requiredWorkload:inventory.requiredWorkload;
 if(workload){
  assert.deepEqual(report.requiredWorkload,workload,'Report cannot waive required400-task/rapid workload');
  for(const row of report.scenarios||[]){
   const setup=row.setup,role=(profile?profile.scenarioRoles:inventory.scenarioRoles)?.[row.name]||'active';
   assert.ok(setup,'Independent400-task durable setup required: '+row.name);
   assert.equal(setup.currentTasks,workload.savedTasks,'Required current400-task source: '+row.name);
   assert.equal(setup.durableTasks,workload.savedTasks,'Required saved400-task readback: '+row.name);
   assert.equal(setup.fixtureRole,role,'Reviewed active/history fixture role: '+row.name);
   assert.match(setup.durableHash||'',/^[a-f0-9]{64}$/,'Exact durable source identity required');
   if(role==='active')assert.equal(setup.activeTasks,workload.savedTasks,'Diagnostic active workload must retain400tasks');
   else assert.ok(['sole','exhausted'].includes(role)&&setup.activeTasks>0,'Documented sole/exhausted workload required');
  }
  const rapid=profile?profile.requiredRapidActions:inventory.requiredRapidActions;
  assert.deepEqual(rapid,actions,'Every button/action family requires rapid coverage');
  assert.deepEqual(report.requiredRapidActions,rapid,'Report cannot waive rapid button families');
  for(const action of rapid){
   const rows=(report.rapidOutcomes||[]).filter(row=>row.action===action);
   assert.equal(rows.length,1,'Missing or duplicate required rapid action: '+action);
   const row=rows[0];assert.equal(row.status,'passed','Required rapid action must pass: '+action);assert.equal(row.responsive,true);assert.ok(row.assertions>0);
   assert.ok(Array.isArray(row.bursts)&&row.bursts.length>0,'Actual native press burst required: '+action);
   for(const burst of row.bursts){
    assert.equal(burst.attempts,workload.rapidAttempts,'Ten native press attempts required: '+action);
    assert.equal(burst.trustedPresses,workload.rapidAttempts,'Trusted native press receipts required: '+action);
    assert.equal(burst.unrelatedClicks,0,'A rapid attempt cannot silently activate another app action: '+action);
    assert.ok(Number.isFinite(burst.windowMs)&&burst.windowMs>=0&&burst.windowMs<=workload.rapidWindowMs,'Ten presses must finish within two seconds: '+action);
    assert.ok(Number.isSafeInteger(burst.acceptedClicks)&&burst.acceptedClicks>0,'Actual action click required: '+action);
    assert.ok(Number.isSafeInteger(burst.refused)&&burst.refused>=0&&Number.isSafeInteger(burst.disappeared)&&burst.disappeared>=0,'Explicit refused/disappeared press classification required');
    assert.equal(burst.acceptedClicks+burst.refused+burst.disappeared,workload.rapidAttempts,'All rapid press attempts must reconcile: '+action);
    assert.ok(typeof burst.semantics==='string'&&burst.semantics.length>=10,'Independent per-control repeated-effect semantics required');
   }
  }
  assert.equal(report.rapidOutcomes.length,rapid.length,'Unexpected or duplicate rapid action');
 }

 if(profile?.fixture){
  const fixture=profile.fixture;
  assert.deepEqual(fixture,{savedTasks:64,source:'signed-out-installed',authMode:'signed-out'},'Reviewed ordinary signed-out64-task base required');
  assert.ok(Array.isArray(scenarios)&&scenarios.length===60,'All sixty ordinary scenario fixtures are required');
  const scenarioFixtures=profile.scenarioFixtures;
  assert.ok(scenarioFixtures&&typeof scenarioFixtures==='object'&&!Array.isArray(scenarioFixtures),'Independent ordinary scenario fixture map required');
  assert.deepEqual(Object.keys(scenarioFixtures).sort(),[...scenarios].sort(),'Exact ordinary scenario fixture keys must match required scenarios');
  const seedVariants={
   'signed-out':{source:'signed-out-installed',syncAccount:null,seedSyncRev:0},
   'reconcile-held':{source:'reconcile-held-installed',syncAccount:'fixture@example.invalid',seedSyncRev:4}
  },fixtureCounts={'signed-out':0,'reconcile-held':0};
  for(const name of scenarios){
   const scenarioFixture=scenarioFixtures[name];assert.ok(scenarioFixture&&typeof scenarioFixture==='object'&&!Array.isArray(scenarioFixture),'Independent ordinary scenario fixture required: '+name);
   assert.deepEqual(Object.keys(scenarioFixture).sort(),['authMode','fixtureRole','savedTasks','seedSyncRev','source','syncAccount'],'Exact ordinary fixture input fields required: '+name);
   assert.equal(scenarioFixture.savedTasks,fixture.savedTasks,'Ordinary scenario keeps the signed-out 64-task base: '+name);
   assert.ok(Object.hasOwn(seedVariants,scenarioFixture.authMode),'Known ordinary auth fixture mode required: '+name);
   const seed=seedVariants[scenarioFixture.authMode];
   assert.equal(scenarioFixture.source,seed.source,'Reviewed ordinary source label required: '+name);
   assert.equal(scenarioFixture.syncAccount,seed.syncAccount,'Reviewed fixture seed account required: '+name);
   assert.equal(scenarioFixture.seedSyncRev,seed.seedSyncRev,'Reviewed fixture seed revision required: '+name);
   const role=profile.scenarioRoles?.[name]||'active';
   assert.equal(scenarioFixture.fixtureRole,role,'Scenario fixture role must match its independent role inventory: '+name);
   fixtureCounts[scenarioFixture.authMode]++;
  }
  assert.deepEqual(fixtureCounts,{'signed-out':54,'reconcile-held':6},'Ordinary profile retains fifty-four signed-out and six existing reconcile-held scenarios');
  // Seed account/revision values describe installed input only; this verifier does not infer post-bootstrap invariants.
  const verifyObservedAuthority=(value,stage,label)=>{
   const message='Actual observed authority '+label;
   assert.ok(value&&typeof value==='object'&&!Array.isArray(value),message+' object required');
   assert.deepEqual(Object.keys(value).sort(),['stage','mode','authUser','account','identity','revision','dirty','cloudStatus'].sort(),message+' exact fields required');
   assert.equal(value.stage,stage,message+' current observation stage required');
   for(const key of ['mode','cloudStatus'])assert.ok(typeof value[key]==='string'&&value[key].trim().length>0,message+' '+key+' required');
   for(const key of ['authUser','account','identity'])assert.ok(value[key]===null||typeof value[key]==='string'&&value[key].trim().length>0,message+' nullable '+key+' required');
   assert.ok(Number.isSafeInteger(value.revision)&&value.revision>=0,message+' nonnegative revision required');assert.equal(typeof value.dirty,'boolean',message+' dirty boolean required');
  };
  const cloudAuthorityStages={
   'cloud sync signs out and rejects signed-out authentication safely':['before-sign-out','signed-out','authentication-refused'],
   'Settings decision review offers Light and saves it while protecting failures':['before-settings','baseline-saved','read-refused','reviewed','selected','write-refused','reviewed-retry','selected-retry','applied']
  };

  for(const row of report.scenarios||[]){
   const setup=row.setup,scenarioFixture=scenarioFixtures[row.name],role=scenarioFixture?.fixtureRole;
   assert.ok(scenarioFixture,'Report cannot add or select an unknown ordinary scenario fixture: '+row.name);
   assert.ok(setup,'Independent ordinary fixture setup required: '+row.name);
   verifyObservedAuthority(setup.observedAuthority,'post-bootstrap',row.name+' bootstrap');
   if(cloudAuthorityStages[row.name]){
    const observations=row.authorityObservations;assert.ok(Array.isArray(observations),'Actual authority observations required at reconciled cloud actions: '+row.name);
    assert.deepEqual(observations.map(value=>value?.stage),cloudAuthorityStages[row.name],'Actual authority observations retain each cloud action stage: '+row.name);
    for(const observation of observations){
     assert.deepEqual(Object.keys(observation).sort(),['stage','authority','currentTasks','durableTasks','currentHash','durableHash'].sort(),'Actual authority observation exact fields required');
     verifyObservedAuthority(observation.authority,observation.stage,row.name+' '+observation.stage);
     assert.equal(observation.currentTasks,64,'Actual authority fixture current64 required: '+row.name);assert.equal(observation.durableTasks,64,'Actual authority fixture durable64 required: '+row.name);
     for(const key of ['currentHash','durableHash'])assert.match(observation[key]||'',/^[a-f0-9]{64}$/,'Actual authority observation source hash required');
    }
   }

   assert.equal(setup.currentTasks,scenarioFixture.savedTasks,'Required ordinary current fixture count: '+row.name);
   assert.equal(setup.durableTasks,scenarioFixture.savedTasks,'Required ordinary durable fixture count: '+row.name);
   assert.equal(setup.source,scenarioFixture.source,'Required ordinary fixture source: '+row.name);
   assert.equal(setup.authMode,scenarioFixture.authMode,'Required ordinary fixture auth mode: '+row.name);
   assert.equal(setup.fixtureRole,role,'Reviewed ordinary active/history fixture role: '+row.name);
   assert.match(setup.durableHash||'',/^[a-f0-9]{64}$/,'Exact ordinary durable source identity required: '+row.name);
   if(role==='active')assert.equal(setup.activeTasks,scenarioFixture.savedTasks,'Ordinary flows require all fixture tasks active: '+row.name);
   else assert.ok(['sole','exhausted'].includes(role)&&setup.activeTasks>0,'Documented ordinary sole/exhausted fixture required: '+row.name);
  }
  assert.ok(Array.isArray(profile.requiredRepeatCases)&&profile.requiredRepeatCases.length>0,'Independent ordinary repeat inventory required');
  const repeatCases=profile.requiredRepeatCases,expectedNames=repeatCases.map(row=>row.name);
  assert.equal(new Set(expectedNames).size,expectedNames.length,'Duplicate expected ordinary repeat case');
  assert.ok(expectedNames.every(name=>scenarios.includes(name)),'Every ordinary repeat is a required state scenario');
  const repeatOutcomes=report.repeatOutcomes;
  assert.ok(Array.isArray(repeatOutcomes),'Trusted ordinary repeat receipts required');
  assert.equal(repeatOutcomes.length,repeatCases.length,'Unexpected ordinary repeat outcome');
  assert.deepEqual(repeatOutcomes.map(row=>row.name).sort(),[...expectedNames].sort(),'Report cannot omit, duplicate or add an ordinary repeat case');
  for(const definition of repeatCases){
   const rows=repeatOutcomes.filter(row=>row.name===definition.name);assert.equal(rows.length,1,'Missing or duplicate ordinary repeat case: '+definition.name);
   const outcome=rows[0];assert.equal(outcome.status,'passed','Ordinary repeat case must pass: '+definition.name);
   assert.ok(Number.isSafeInteger(definition.minimumAttempts)&&definition.minimumAttempts>0,'Independent ordinary repeat attempt minimum required: '+definition.name);
   const attempts=outcome.attempts;assert.ok(Array.isArray(attempts)&&attempts.length>=definition.minimumAttempts,'Trusted repeated native attempts required: '+definition.name);
   const receiptIds=attempts.map(row=>row.receiptId);assert.ok(receiptIds.every(id=>typeof id==='string'&&id.length>0),'Unique native attempt receipts required: '+definition.name);
   assert.equal(new Set(receiptIds).size,receiptIds.length,'Duplicate native attempt receipt: '+definition.name);
   const counts={attempted:attempts.length,accepted:0,refused:0,disappeared:0},seenFamilies=new Set();
   for(const attempt of attempts){
    assert.equal(attempt.trusted,true,'Trusted native input receipt required: '+definition.name);
    assert.ok(Array.isArray(definition.actionFamilies)&&definition.actionFamilies.includes(attempt.actionFamily),'Ordinary repeat action is not owned by its case: '+definition.name);
    seenFamilies.add(attempt.actionFamily);
    assert.ok(['accepted','refused','disappeared'].includes(attempt.result),'Explicit native input outcome required: '+definition.name);
    counts[attempt.result]+=1;
    assert.ok(Number.isFinite(attempt.receiptAtMs)&&attempt.receiptAtMs>=0,'Native receipt time required: '+definition.name);
   }
   for(const family of definition.actionFamilies)assert.ok(seenFamilies.has(family),'Ordinary repeat is missing owned action family '+family+': '+definition.name);
   assert.deepEqual(outcome.accounting,counts,'Ordinary repeated native inputs must reconcile: '+definition.name);
   const assertions=outcome.assertions;assert.ok(Array.isArray(assertions)&&assertions.length===1,'Independent ordinary semantic assertion required: '+definition.name);
   assert.equal(assertions[0].id,definition.assertionId,'Ordinary semantic assertion identity mismatch: '+definition.name);
   assert.equal(assertions[0].status,'passed','Ordinary semantic assertion must pass: '+definition.name);
   assert.equal(assertions[0].expected,definition.expected,'Ordinary semantic assertion must match the reviewed expectation: '+definition.name);
   assert.ok(typeof assertions[0].evidence==='string'&&assertions[0].evidence.trim().length>0,'Ordinary semantic assertion evidence required: '+definition.name);
   const scenario=(report.scenarios||[]).find(row=>row.name===definition.name);
   assert.ok(scenario?.setup,'Ordinary repeat source scenario setup required: '+definition.name);
   const source=outcome.sourceIdentity;
   assert.ok(source&&typeof source==='object','Ordinary repeat source identity required: '+definition.name);
   assert.equal(source.candidateCommit,report.candidateCommit,'Ordinary repeat candidate commit mismatch: '+definition.name);
   assert.equal(source.candidateTree,report.candidateTree,'Ordinary repeat candidate tree mismatch: '+definition.name);
   assert.equal(source.inventorySha256,report.inventorySha256,'Ordinary repeat inventory identity mismatch: '+definition.name);
   assert.equal(source.durableHash,scenario.setup.durableHash,'Ordinary repeat durable source mismatch: '+definition.name);
  }
 }
 assert.ok(Array.isArray(report.observedActions),'Observed native button inventory required');
 for(const action of report.observedActions)assert.ok(actions.includes(action),'New untested button action: '+action);
 assert.deepEqual(report.errors,[],'Native lifecycle or error detector failed');
 for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(report.cleanup?.[key],true,'Button runtime cleanup required: '+key);
 return report.startupTimeline?{...report,startupTimeline:classifyButtonStartupTimeline(report.startupTimeline,report.startupCapture,nativeInputs)}:report;
}
