import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { verifyRetainedEarlyReceipt, verifyEarlyMobileReport } from '../early-ci.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=value=>typeof value==='string'&&/^[A-Za-z0-9_./-]+$/.test(value)&&!value.startsWith('/')&&!value.split('/').some(part=>!part||part==='.'||part==='..');

// Native reports can exceed spawnSync's buffered-read limit. Hash their full
// stream in an isolated verifier, stopping immediately above the declared size.
const memberStreamVerifier=`
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const [archive,entry,expectedText]=process.argv.slice(1),expected=Number(expectedText);
const digest=createHash('sha256');let bytes=0,overflow=false;
const child=spawn('unzip',['-p',archive,entry],{stdio:['ignore','pipe','ignore']});
const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>expected){overflow=true;child.kill('SIGKILL');}else digest.update(chunk);});
child.on('error',()=>{process.exitCode=1;});
child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal||overflow||bytes!==expected){process.exitCode=1;return;}process.stdout.write(JSON.stringify({bytes,sha256:digest.digest('hex')}));});
`;

function verifyStream(archive,entry,expected,bytes){
  if(!Number.isSafeInteger(bytes)||bytes<0||!/^[a-f0-9]{64}$/.test(expected||''))throw new Error('Original member identity is incomplete.');
  const result=spawnSync(process.execPath,['--input-type=module','-e',memberStreamVerifier,archive,entry,String(bytes)],{encoding:'utf8',maxBuffer:4096,timeout:12000});
  if(result.status!==0||result.error)throw new Error('Original evidence stream could not be verified.');
  const observed=JSON.parse(result.stdout);
  if(observed.bytes!==bytes||observed.sha256!==expected)throw new Error('Original evidence member hash or size changed.');
}

// Read immutable original uploads, never extract their paths into the checkout.
// The callback retains API observations and archives in the caller's evidence.
export function originalArtifactVerifier(readApi){
  const inventories=new Map(),archives=new Map();
  return (pass,job)=>{
    const original=pass.coveredBy,gate=pass.gate,emulator=['rules','compatibility'].includes(gate);
    if(!inventories.has(original.runId))inventories.set(original.runId,readApi(`actions/runs/${original.runId}/artifacts?per_page=100`));
    const inventory=inventories.get(original.runId);
    if(!Array.isArray(inventory.artifacts)||inventory.total_count!==inventory.artifacts.length)throw new Error('Original artifact inventory is incomplete.');
    const name=emulator?`event-gates-${original.runId}-${original.runAttempt}`:`regression-${original.runId}-${original.runAttempt}-${gate}`;
    const matches=inventory.artifacts.filter(artifact=>artifact.name===name);
    if(matches.length!==1)throw new Error('Original artifact is missing or ambiguous.');
    const artifact=matches[0],created=Date.parse(artifact.created_at);
    if(!/^[1-9][0-9]*$/.test(String(artifact.id))||artifact.expired!==false||!(Date.parse(artifact.expires_at)>Date.now())||
      !(Date.parse(job.started_at)<=created&&created<=Date.parse(job.completed_at))||String(artifact.workflow_run?.id)!==original.runId||artifact.workflow_run?.head_sha!==original.sourceSha||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest))throw new Error('Original artifact is expired or does not belong to the original execution.');
    if(!archives.has(artifact.id)){
      const archive=readApi(`actions/artifacts/${artifact.id}/zip`,true);
      if(archive.sha256!==artifact.digest.slice(7))throw new Error('Original archive digest changed.');
      const listing=spawnSync('unzip',['-Z1',archive.path],{encoding:'utf8',maxBuffer:1024*1024,timeout:10000});
      if(listing.status!==0||listing.error)throw new Error('Original archive cannot be inspected.');
      const files=listing.stdout.trim().split('\n').filter(name=>!name.endsWith('/'));
      if(new Set(files).size!==files.length||files.some(name=>!safePath(name)))throw new Error('Original archive has unsafe or ambiguous entries.');
      archives.set(artifact.id,{...archive,files:new Set(files)});
    }
    const archive=archives.get(artifact.id),prefix=emulator?gate+'/':'';
    const read=(relative,expected,bytes)=>{
      const entry=prefix+relative;
      if(!safePath(relative)||!archive.files.has(entry))throw new Error('Original evidence member is unavailable.');
      const result=spawnSync('unzip',['-p',archive.path,entry],{maxBuffer:32*1024*1024,timeout:10000});
      if(result.status!==0||result.error||hash(result.stdout)!==expected||(bytes!==undefined&&result.stdout.length!==bytes))throw new Error('Original evidence member hash or size changed.');
      return result.stdout;
    };
    const report=JSON.parse(read('result.json',original.resultSha256).toString('utf8'));
    const identity=report.resultIdentity;
    for(const key of ['runId','runAttempt','sourceSha','checkoutSha','checkoutTree','comparisonBase'])if(['runId','runAttempt'].includes(key)?String(identity?.[key])!==original[key]:identity?.[key]!==original[key])throw new Error('Original result identity changed: '+key);
    if(identity.repository!==pass.inputs.repository||identity.selectedGroup!==gate||identity.checkoutDirty!==false||report.status!=='passed'||report.coverage||report.process?.exitCode!==0||report.process.signal||report.process.error||report.process.spawnError)throw new Error('Original result is not a clean successful execution.');
    if(emulator){
      if(!(report.tests>=(gate==='rules'?24:15))||report.tests!==report.passed)throw new Error('Original emulator cohort is incomplete.');
      read('stdout.tap',report.process.stdoutSha256);read('stderr.log',report.process.stderrSha256);
    }else{
      if(report.issues?.length!==0||!Array.isArray(report.cases)||!report.cases.length||!Array.isArray(report.artifacts))throw new Error('Original group cohort is incomplete.');
      for(const output of [report.process.stdout,report.process.stderr])read(output?.path,output?.sha256);
      for(const observed of report.unclassifiedRootGuard?.files||[])for(const output of [observed.stdout,observed.stderr,observed.summary])read(output?.path,output?.sha256);
      for(const key of ['earlyReceiptRef','browserRuntimeReceipt'])if(report[key]){
        const reference=report[key],receipt=JSON.parse(read(reference.path,reference.sha256).toString('utf8'));
        const receiptIdentity=key==='earlyReceiptRef'?receipt.identity?.descriptor:receipt.resultIdentity;
        for(const field of ['repository','runId','runAttempt','sourceSha','checkoutSha','checkoutTree','comparisonBase'])if(String(receiptIdentity?.[field])!==String(identity[field]))throw new Error('Original transferred receipt identity changed: '+field);
        if(!['passed','no_change'].includes(receipt.status)||!Array.isArray(receipt.artifacts))throw new Error('Original transferred receipt is incomplete.');
        const directory=path.posix.dirname(reference.path),members=new Set();
        for(const member of receipt.artifacts){
          if(!safePath(member.path)||members.has(member.path))throw new Error('Unsafe or duplicate transferred artifact.');members.add(member.path);
          const entry=directory+'/'+member.path;if(!archive.files.has(entry))throw new Error('Original transferred artifact is missing.');
          verifyStream(archive.path,entry,member.sha256,member.bytes);
        }
        for(const output of [receipt.process?.stdout,receipt.process?.stderr].filter(Boolean))read(directory+'/'+output.path,output.sha256);
      }
      if(report.earlyCoverage&&(!report.earlyReceiptRef||report.earlyReceiptRef.sha256!==report.earlyCoverage.receiptSha256))throw new Error('Original transferred early proof is unavailable.');
      for(const member of report.artifacts){
        if(!safePath(member.path)||!archive.files.has(member.path))throw new Error('Original evidence member is unavailable.');
        verifyStream(archive.path,member.path,member.sha256,member.bytes);
      }
    }
    return {artifactId:String(artifact.id),artifactName:name,artifactSha256:archive.sha256,artifactExpiresAt:artifact.expires_at};
  };
}

// Early execution is an independent origin, even when unrelated groups made
// the enclosing aggregate mixed. It never grants full-product authority.
export function originalEarlyVerifier(readApi,{repo=process.cwd()}={}){
 return (context,run,jobs,inputs)=>{
  const completed=step=>step.status==='completed'&&step.conclusion==='success';
  const jobFor=name=>{const matches=jobs.filter(job=>job.name===name&&String(job.run_id)===String(run.id)&&String(job.run_attempt)===String(run.run_attempt)&&job.head_sha===run.head_sha&&job.status==='completed'&&job.conclusion==='success');if(matches.length!==1)throw new Error('Original early topology is incomplete: '+name);return matches[0];};
  const early=jobFor('early-startup'),stress=jobFor('mobile-stress');
  const marks=(early.steps||[]).filter(step=>completed(step)&&/^Complete early startup report [a-f0-9]{64}$/.test(step.name));
  if(marks.length!==1||(early.steps||[]).filter(step=>completed(step)&&step.name==='Required saved harness and populated mobile startup').length!==1||(stress.steps||[]).filter(step=>completed(step)&&step.name==='Report 512MB application stress with required execution integrity').length!==1)throw new Error('Original early or stress execution markers are absent.');
  const listing=readApi(`actions/runs/${run.id}/artifacts?per_page=100`);if(!Array.isArray(listing.artifacts)||listing.total_count!==listing.artifacts.length)throw new Error('Original early artifact inventory is incomplete.');
  function materialize(name,job,entry,expected){
   const matches=listing.artifacts.filter(item=>item.name===`${name}-${run.id}-${run.run_attempt}`);if(matches.length!==1)throw new Error('Original early upload is absent or ambiguous.');
   const artifact=matches[0],created=Date.parse(artifact.created_at);
   if(!/^[1-9][0-9]*$/.test(String(artifact.id))||artifact.expired!==false||!(Date.parse(artifact.expires_at)>Date.now())||!(Date.parse(job.started_at)<=created&&created<=Date.parse(job.completed_at))||String(artifact.workflow_run?.id)!==String(run.id)||artifact.workflow_run?.head_sha!==run.head_sha||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest))throw new Error('Original early upload identity changed.');
   const archive=readApi(`actions/artifacts/${artifact.id}/zip`,true);if(archive.sha256!==artifact.digest.slice(7))throw new Error('Original early archive digest changed.');
   const list=spawnSync('unzip',['-Z1',archive.path],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});if(list.status!==0||list.error)throw new Error('Original early archive cannot be inspected.');
   const files=list.stdout.trim().split('\n').filter(name=>!name.endsWith('/'));if(files.length>4096||new Set(files).size!==files.length||files.some(name=>!safePath(name))||!files.includes(entry))throw new Error('Original early archive has unsafe or incomplete members.');
   const raw=spawnSync('unzip',['-p',archive.path,entry],{maxBuffer:32*1024*1024,timeout:10000});if(raw.status!==0||raw.error||expected&&hash(raw.stdout)!==expected)throw new Error('Original early report changed.');
   const report=JSON.parse(raw.stdout.toString('utf8')),members=[{path:entry,bytes:raw.stdout.length,sha256:hash(raw.stdout)},...(report.artifacts||[])];
   if(!Array.isArray(report.artifacts)||new Set(members.map(item=>item.path)).size!==members.length||files.length!==members.length||members.some(item=>!files.includes(item.path)||!safePath(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0)||members.reduce((sum,item)=>sum+item.bytes,0)>1024*1024*1024)throw new Error('Original early raw inventory is incomplete or exceeds its bound.');
   const directory=mkdtempSync(path.join(path.dirname(archive.path),'original-'+name+'-'));
   for(const member of members){verifyStream(archive.path,member.path,member.sha256,member.bytes);const target=path.join(directory,member.path);mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const fd=openSync(target,'wx',0o600);let extracted;try{extracted=spawnSync('unzip',['-p',archive.path,member.path],{stdio:['ignore',fd,'pipe'],maxBuffer:1024*1024,timeout:10000});}finally{closeSync(fd);}if(extracted.status!==0||extracted.error)throw new Error('Original early member could not be retained.');}
   return {directory,report,reference:{artifactId:String(artifact.id),artifactName:artifact.name,artifactSha256:archive.sha256,artifactExpiresAt:artifact.expires_at,reportSha256:hash(raw.stdout)}};
  }
  const original=materialize('early-startup',early,'receipt.json',marks[0].name.split(' report ')[1]),identity=original.report.identity,id=identity?.descriptor;
  for(const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase','cohortDigestSha256','inventorySha256','assignmentsSha256','expectedGroups'])if(JSON.stringify(id?.[key])!==JSON.stringify(context[key]))throw new Error('Original early context mismatch: '+key);
  if(!inputs){
   const runtime=identity?.runtime;
   if(!['node','platform','arch','imageOS','imageVersion'].every(key=>typeof runtime?.[key]==='string'&&runtime[key]))throw new Error('Original early runtime is incomplete.');
   inputs={policy:'complete-ci-inputs-v1',repository:context.repository,checkoutTree:context.checkoutTree,comparisonBase:context.comparisonBase,runtime};
  }
  if(String(id.runId)!==String(run.id)||Number(id.runAttempt)!==Number(run.run_attempt)||id.checkoutDirty||identity.workflowBlob!==context.workflowBlob||JSON.stringify(identity.runtime)!==JSON.stringify(inputs.runtime)||identity.harnessSourceSha256!==hash(readFileSync(path.join(repo,'scripts/early-ci-harness-source.json'))))throw new Error('Original early source/runtime identity changed.');
  verifyRetainedEarlyReceipt(path.join(original.directory,'receipt.json'),identity,{repo});
  const stressOriginal=materialize('mobile-stress',stress,'report.json');verifyEarlyMobileReport(stressOriginal.directory,id,true,repo);
  return {kind:'ci-early-execution-v1',inputs,coveredBy:{runId:String(run.id),runAttempt:String(run.run_attempt),earlyJobId:String(early.id),stressJobId:String(stress.id),sourceSha:id.sourceSha,checkoutSha:id.checkoutSha,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,earlyReportSha256:original.reference.reportSha256,earlyArtifact:original.reference,stressArtifact:stressOriginal.reference}};
 };
}

export function verifyOriginalAggregate(readApi,{context,run,job,reportSha256,retained,early}){
 const response=readApi(`actions/runs/${run.id}/artifacts?per_page=100`),name=`scanner-aggregate-${run.id}-${run.run_attempt}`;
 if(!Array.isArray(response.artifacts)||response.total_count!==response.artifacts.length)throw new Error('Original aggregate artifact inventory is incomplete.');
 const matches=response.artifacts.filter(item=>item.name===name);if(matches.length!==1)throw new Error('Original full aggregate upload is absent or ambiguous.');
 const artifact=matches[0],created=Date.parse(artifact.created_at);
 if(!/^[1-9][0-9]*$/.test(String(artifact.id))||artifact.expired!==false||!(Date.parse(artifact.expires_at)>Date.now())||!(Date.parse(job.started_at)<=created&&created<=Date.parse(job.completed_at))||String(artifact.workflow_run?.id)!==String(run.id)||artifact.workflow_run?.head_sha!==run.head_sha||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest))throw new Error('Original aggregate upload identity changed.');
 const archive=readApi(`actions/artifacts/${artifact.id}/zip`,true);if(archive.sha256!==artifact.digest.slice(7))throw new Error('Original aggregate archive changed.');
 const listed=spawnSync('unzip',['-Z1',archive.path],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}),files=listed.stdout?.trim().split('\n').filter(name=>!name.endsWith('/'))||[];
 if(listed.status!==0||listed.error||new Set(files).size!==files.length||files.some(name=>!safePath(name)))throw new Error('Original aggregate archive is unsafe or unreadable.');
 const members=files.filter(name=>name==='aggregate/aggregate.json'||name==='aggregate.json');if(members.length!==1)throw new Error('Original aggregate report is absent or ambiguous.');
 const raw=spawnSync('unzip',['-p',archive.path,members[0]],{timeout:10000,maxBuffer:32*1024*1024});if(raw.status!==0||raw.error||hash(raw.stdout)!==reportSha256)throw new Error('Original aggregate report changed.');
 const report=JSON.parse(raw.stdout.toString('utf8')),id=report.resultIdentity;
 for(const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase','cohortDigestSha256','inventorySha256','assignmentsSha256','expectedGroups'])if(JSON.stringify(id?.[key])!==JSON.stringify(context[key]))throw new Error('Original aggregate context mismatch: '+key);
 if(String(id.runId)!==String(run.id)||Number(id.runAttempt)!==Number(run.run_attempt)||id.checkoutDirty||report.status!=='passed'||report.mode!=='full'||report.issues?.length!==0||!Array.isArray(report.groups)||report.groups.length!==4||Object.keys(report.emulatorCoverage||{}).length||!(report.caseCount>0)||report.caseCount!==report.groups.reduce((sum,group)=>sum+group.cases+(group.earlyCases||0),0))throw new Error('Policy inheritance requires an original completely executed full aggregate.');
 for(const gate of context.expectedGroups){const groups=report.groups.filter(group=>group.group===gate);if(groups.length!==1||groups[0].mode==='covered'||groups[0].mode==='mixed'||groups[0].resultSha256!==retained[gate]?.coveredBy.resultSha256)throw new Error('Original aggregate does not bind its exact executed group results.');}
 if(early&&(report.earlyEvidence?.mode!=='full'||report.earlyEvidence.receiptSha256!==early.coveredBy.earlyReportSha256||report.stressEvidence?.reportSha256!==early.coveredBy.stressArtifact.reportSha256))throw new Error('Original aggregate early/stress references changed.');
 return{artifactId:String(artifact.id),artifactName:name,artifactSha256:archive.sha256,artifactExpiresAt:artifact.expires_at,reportSha256};
}
