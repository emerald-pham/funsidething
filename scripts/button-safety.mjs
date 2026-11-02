#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,verifyButtonSafetyReport,verifyButtonInventorySource,verifyButtonStartupCapture,classifyButtonStartupTimeline} from './button-safety-contract.mjs';
export {digest,verifyButtonSafetyReport,verifyButtonInventorySource,sourceButtonTemplates} from './button-safety-contract.mjs';
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
 const referenceRequested=process.argv.slice(2).some(arg=>arg.startsWith('--startup-evidence-view'));
 try{
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1],profile=args.includes('--profile')?value('--profile'):undefined;
  const viewFlags=args.map((arg,index)=>arg==='--startup-evidence-view'?index:-1).filter(index=>index>=0);
  if(args.some(arg=>arg.startsWith('--startup-evidence-view')&&arg!=='--startup-evidence-view'))throw Error('Unknown startup evidence view option');
  if(viewFlags.length>1)throw Error('Duplicate startup evidence view option');
  const startupEvidenceView=viewFlags.length?args[viewFlags[0]+1]:undefined;
  if(viewFlags.length&&startupEvidenceView!=='canonical-reference-v1')throw Error('Unknown startup evidence view; explicit canonical-reference-v1 required');
  if(viewFlags.length&&!(args.includes('--verify-report')&&args.includes('--startup-opening')&&args.includes('--startup-evidence')&&!args.includes('--run')&&!args.includes('--check-inventory')))throw Error('Startup evidence view requires explicit --verify-report --startup-opening --startup-evidence');
  const retentionFlags=args.map((arg,index)=>arg==='--startup-retention-profile'?index:-1).filter(index=>index>=0);
  if(retentionFlags.length>1)throw Error('Duplicate startup retention profile option');
  const startupRetentionProfile=retentionFlags.length?args[retentionFlags[0]+1]:undefined;
  if(retentionFlags.length&&!['canonical-json-48mib-memory-png-v1','canonical-json-56mib-memory-png-v1','canonical-json-4216mib-memory-png-v1'].includes(startupRetentionProfile))throw Error('Unknown startup retention profile: '+startupRetentionProfile);
  if(startupRetentionProfile==='canonical-json-4216mib-memory-png-v1'&&args.includes('--verify-report')&&startupEvidenceView!=='canonical-reference-v1')throw Error('Full-domain startup retention profile requires explicit canonical-reference-v1 evidence view');
  const linuxFlags=args.filter(arg=>arg==='--linux-failure-observation');
  if(args.some(arg=>arg.startsWith('--linux-failure-observation')&&arg!=='--linux-failure-observation'))throw Error('Unknown Linux failure observation option');
  if(linuxFlags.length>1)throw Error('Duplicate Linux failure observation option');
  const linuxFailureObservation=linuxFlags.length?value('--linux-failure-observation'):null;
  if(linuxFlags.length&&(linuxFailureObservation!=='linux-webkit-frontier-v1'||!args.includes('--run')||args.includes('--startup-opening')))throw Error('Known explicit Linux diagnostic-only run required');
  const historyFlags=args.filter(arg=>arg==='--linux-failure-history');
  if(args.some(arg=>arg.startsWith('--linux-failure-history')&&arg!=='--linux-failure-history')||historyFlags.length>1)throw Error('Unknown or duplicate Linux failure history option');
  const linuxFailureHistory=historyFlags.length?value('--linux-failure-history'):null;
  if(historyFlags.length&&(!linuxFailureObservation||!linuxFailureHistory||linuxFailureHistory.startsWith('--')||!args.includes('--scenario')||value('--scenario')!=='ordinary scene choice survives reopen and task Undo'||args.includes('--probe')))throw Error('Linux failure history requires the exact scene diagnostic and original failed report');
  const startupCapture=args.includes('--startup-capture')?value('--startup-capture'):null;
  if(startupRetentionProfile!==undefined&&!(args.includes('--startup-opening')&&(profile===undefined||profile==='ordinary')&&(args.includes('--verify-report')||args.includes('--run')&&startupCapture==='timeline')))throw Error('Native Timeline retention profile requires ordinary startup Timeline run or explicit startup verification');
  if(args.includes('--startup-capture')&&!['jpeg','timeline'].includes(startupCapture))throw Error('Startup capture selection requires explicit jpeg or timeline mode');
  if(args.includes('--verify-report')&&args.includes('--startup-opening')){
   if(!args.includes('--startup-evidence'))throw Error('Ordinary startup explicit evidence manifest required');
   if(startupEvidenceView!==undefined){
    const result=classifyButtonStartupTimeline(null,null,{artifactInput:{reportReferencePath:path.resolve(value('--verify-report')),evidencePath:path.resolve(value('--startup-evidence'))},...(startupRetentionProfile===undefined?{}:{retentionProfile:startupRetentionProfile}),evidenceView:startupEvidenceView});
    process.stdout.write(JSON.stringify(result)+'\n');
   }else{
   const specPath=path.resolve(value('--startup-evidence')),root=path.dirname(specPath),read=relative=>{if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw Error('Ordinary startup owned relative file required');const file=path.join(root,relative);if(fs.lstatSync(file).isSymbolicLink()||!fs.lstatSync(file).isFile()||fs.realpathSync(file)!==file)throw Error('Ordinary startup source symlink/escape refused');return fs.readFileSync(file);};
   if(fs.lstatSync(specPath).isSymbolicLink()||fs.realpathSync(specPath)!==specPath)throw Error('Ordinary startup evidence symlink refused');const spec=JSON.parse(fs.readFileSync(specPath)),reference=JSON.parse(fs.readFileSync(value('--verify-report'))),reportBytes=read(reference.reportPath);if(digest(reportBytes)!==reference.sha256)throw Error('Ordinary startup report reference mismatch');const report=JSON.parse(reportBytes);if(report.kind!=='startup-diagnostic'||report.scope!=='ordinary-startup-diagnostic')throw Error('Ordinary startup diagnostic report required');for(const key of ['contextClosed','browserClosed','serverClosed'])if(report.cleanup?.[key]!==true)throw Error('Ordinary startup owned cleanup required: '+key);
   const captureBytes=read(spec.capturePath),rawInventoryBytes=read(spec.rawInventoryPath);if(digest(captureBytes)!==spec.captureSha256||digest(rawInventoryBytes)!==spec.rawInventorySha256)throw Error('Ordinary startup original raw identity mismatch');const capture=JSON.parse(captureBytes),inventory=JSON.parse(rawInventoryBytes);
   if(capture.schemaVersion===3){
    verifyButtonStartupCapture(capture,{retentionProfile:startupRetentionProfile});
    if(spec.retentionProfile!==startupRetentionProfile)throw Error('Native Timeline selected retention profile manifest mismatch');
    const directory=path.join(root,'startup-timeline'),directoryStat=fs.lstatSync(directory);if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory()||fs.realpathSync(directory)!==directory)throw Error('Native Timeline selected retention profile raw namespace refused');
    const names=fs.readdirSync(directory);if(names.some(name=>name.endsWith('.png')))throw Error('Native Timeline selected retention profile forbids persistent PNG files');
    const physical=[...capture.events,...(capture.orphans||[])],expected=physical.map(row=>path.basename(row.path));
    if(names.length!==expected.length||names.some(name=>!expected.includes(name))||!Array.isArray(inventory)||inventory.length!==physical.length+capture.frames.length)throw Error('Native Timeline selected retention profile raw namespace mismatch');
    for(const row of physical){const file=path.join(root,row.path),s=fs.lstatSync(file);if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1||typeof process.getuid==='function'&&s.uid!==process.getuid()||s.size!==row.bytes)throw Error('Native Timeline selected retention profile raw namespace identity mismatch');}
   }else if(startupRetentionProfile!==undefined)throw Error('Native Timeline retention profile does not match capture schema');
   const rawFiles=new Map(inventory.filter(row=>![2,3].includes(capture.schemaVersion)||row.kind!=='derived-png').map(row=>[row.path,read(row.path)])),sources=spec.sources.map(row=>({...row,bytes:read(row.path)})),appBinding={...spec.appBinding,fixtureBytes:read(spec.fixturePath)};
   const result=classifyButtonStartupTimeline(report.startupObservation,capture,{...(startupRetentionProfile===undefined?{}:{retentionProfile:startupRetentionProfile}),captureBytes,expectedCaptureSha256:spec.captureSha256,rawInventoryBytes,rawFiles,sources,producer:spec.producer,consumer:{kind:'explicit-diagnostic-verification',modules:['scripts/button-safety.mjs','scripts/button-safety-contract.mjs','scripts/button-safety-startup.mjs','scripts/button-safety-timeline-core.mjs'].map(file=>({path:file,sha256:digest(fs.readFileSync(file))}))},appBinding});
   process.stdout.write('Ordinary startup diagnostic artifact valid; observation status='+result.status+'; functional status='+report.status+'; root route decision required.\n'+JSON.stringify(result,null,2)+'\n');
   }
  }else if(args.includes('--startup-evidence'))throw Error('Ordinary startup evidence requires explicit --verify-report --startup-opening');
  else if(args.includes('--verify-report')){
   const inventory=args.includes('--inventory')?fs.readFileSync(value('--inventory')):null;
   verifyButtonSafetyReport(JSON.parse(fs.readFileSync(value('--verify-report'),'utf8')),{...(inventory?{inventory:JSON.parse(inventory),inventorySha256:digest(inventory)}:{}),...(profile===undefined?{}:{expectedProfile:profile})});
   process.stdout.write('Button safety report verified.\n');
  }else if(args.includes('--check-inventory')){verifyButtonInventorySource(fs.readFileSync(value('--source'),'utf8'),JSON.parse(fs.readFileSync(value('--inventory'),'utf8')));process.stdout.write('Source button inventory verified.\n');}else if(args.includes('--run')){const {runButtonSafety}=await import('./button-safety-native.mjs');const mobileYesMotion=args.includes('--mobile-yes')?(value('--motion')||'normal'):null;const selectedProfile=mobileYesMotion?'workload-diagnostic':profile??'ordinary';const result=await runButtonSafety({repo:process.cwd(),engine:value('--engine'),outputDir:value('--output-dir'),port:Number(value('--port')||0),profile,control:args.includes('--control')?value('--control'):null,probe:args.includes('--probe'),scenarioFilter:args.includes('--scenario')?value('--scenario'):null,mobileYesMotion,linuxFailureObservation,linuxFailureHistory,startupOpening:args.includes('--startup-opening')?{sourceCommit:value('--source-commit'),raw:fs.readFileSync(value('--fixture-file'),'utf8')}:null,startupCapture,...(startupRetentionProfile===undefined?{}:{startupRetentionProfile})});process.stdout.write('Button evidence: '+result.reportPath+'\n');if(!args.includes('--probe')&&!args.includes('--scenario')&&!args.includes('--mobile-yes')&&!args.includes('--startup-opening')){const bytes=fs.readFileSync('scripts/button-safety-inventory.json');verifyButtonSafetyReport(result.report,{inventory:JSON.parse(bytes),inventorySha256:digest(bytes),expectedProfile:selectedProfile});}}else throw Error('Choose --verify-report or --run');
 }catch(error){
  if(referenceRequested){const bytes=Buffer.from('Startup reference verification refused: '+(typeof error?.message==='string'?error.message:'Unknown failure')+'\n'),suffix=Buffer.from(' [detail truncated]\n');if(bytes.length<=4096)process.stderr.write(bytes);else{let end=4096-suffix.length;while(end>0&&(bytes[end]&0xc0)===0x80)end--;process.stderr.write(Buffer.concat([bytes.subarray(0,end),suffix]));}}
  else process.stderr.write(error.message+'\n');process.exitCode=1;
 }
}
