import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=value=>typeof value==='string'&&/^[A-Za-z0-9_./-]+$/.test(value)&&!value.startsWith('/')&&!value.split('/').some(part=>!part||part==='.'||part==='..');

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
    for(const key of ['runId','runAttempt','sourceSha','checkoutSha','checkoutTree','comparisonBase'])if(identity?.[key]!==original[key])throw new Error('Original result identity changed: '+key);
    if(identity.repository!==pass.inputs.repository||identity.selectedGroup!==gate||identity.checkoutDirty!==false||report.status!=='passed'||report.coverage||report.process?.exitCode!==0||report.process.signal||report.process.error||report.process.spawnError)throw new Error('Original result is not a clean successful execution.');
    if(emulator){
      if(!(report.tests>=(gate==='rules'?24:15))||report.tests!==report.passed)throw new Error('Original emulator cohort is incomplete.');
      read('stdout.tap',report.process.stdoutSha256);read('stderr.log',report.process.stderrSha256);
    }else{
      if(report.issues?.length!==0||!Array.isArray(report.cases)||!report.cases.length||!Array.isArray(report.artifacts))throw new Error('Original group cohort is incomplete.');
      for(const output of [report.process.stdout,report.process.stderr])read(output?.path,output?.sha256);
      for(const observed of report.unclassifiedRootGuard?.files||[])for(const output of [observed.stdout,observed.stderr,observed.summary])read(output?.path,output?.sha256);
      for(const member of report.artifacts)read(member.path,member.sha256,member.bytes);
    }
    return {artifactId:String(artifact.id),artifactName:name,artifactSha256:archive.sha256,artifactExpiresAt:artifact.expires_at};
  };
}
