#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CI_GATES = ['core', 'scenery', 'persistence-recovery', 'native-process', 'rules', 'compatibility'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const decimal = value => /^[1-9][0-9]*$/.test(String(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const successful = step => step.status === 'completed' && step.conclusion === 'success';

export function ciInputContext(validationContext) {
  return {
    policy: 'complete-ci-inputs-v1', repository: validationContext.repository,
    checkoutTree: validationContext.checkoutTree, comparisonBase: validationContext.comparisonBase,
    runtime: { ...validationContext.runtime, imageOS: process.env.ImageOS || '', imageVersion: process.env.ImageVersion || '' },
  };
}

export const ciInputKey = (inputs, gate) => digest({ ...inputs, gate });

export function validateInputPass(pass, identity, { execution = true } = {}) {
  const expected = ciInputContext({ ...identity, runtime: execution ? { node: process.versions.node, platform: process.platform, arch: process.arch } : pass?.inputs?.runtime });
  if(!execution){expected.runtime=pass?.inputs?.runtime;if(!['node','platform','arch','imageOS','imageVersion'].every(key=>typeof expected.runtime?.[key]==='string'&&expected.runtime[key]))throw new Error('Original execution runtime is incomplete.');}
  if (identity.checkoutDirty || !expected.runtime.imageOS || !expected.runtime.imageVersion || pass?.kind !== 'ci-input-pass-v1' ||
    pass.gate !== identity.selectedGroup || !CI_GATES.includes(pass.gate) || JSON.stringify(pass.inputs) !== JSON.stringify(expected) || pass.inputKey !== ciInputKey(expected,pass.gate)) throw new Error('Input pass does not match the complete current group inputs/runtime.');
  const producer = pass.coveredBy;
  if (!['runId','runAttempt','jobId'].every(key => decimal(producer?.[key])) || !['sourceSha','checkoutSha'].every(key => sha(producer?.[key])) ||
    producer.checkoutTree !== identity.checkoutTree || producer.comparisonBase !== identity.comparisonBase || !/^[a-f0-9]{64}$/.test(producer.resultSha256) ||
    !decimal(producer.artifactId)||!/^[a-f0-9]{64}$/.test(producer.artifactSha256)||typeof producer.artifactName!=='string'||!(Date.parse(producer.artifactExpiresAt)>Date.now())) throw new Error('Original input-pass producer identity is incomplete.');
  return pass;
}

// Only original executed jobs publish this marker. Reused jobs preserve the
// original reference and never extend the chain of authority.
export function findInputPasses(record, readApi, verifyArtifact) {
  const inputs = record.inputContext;
  if (!inputs.runtime.imageOS || !inputs.runtime.imageVersion) return {};
  const response = readApi('actions/workflows/data-safety.yml/runs?per_page=20');
  if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count)) throw new Error('CI producer inventory is unavailable.');
  const passes = {}, observations = Object.fromEntries(CI_GATES.map(gate => [gate, []]));
  const eligible = run => decimal(run?.id) && decimal(run?.run_attempt) && sha(run?.head_sha) &&
    ['push', 'pull_request'].includes(run.event) && ['completed','in_progress'].includes(run.status) &&
    run.path === '.github/workflows/data-safety.yml' && run.name === 'Data safety' &&
    run.repository?.full_name === inputs.repository && run.head_repository?.full_name === inputs.repository;
  const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)?Date.parse(value):NaN;
  const commits=new Map();
  for(const latest of response.workflow_runs.filter(eligible).sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,16)){
    const own=String(latest.id)===record.runId;
    if(own&&(String(latest.run_attempt)!==record.runAttempt||latest.head_sha!==record.validationContext.sourceSha))continue;
    const attempts=own?[]:[latest];
    for(let attempt=Number(latest.run_attempt)-1;attempt>=Math.max(1,Number(latest.run_attempt)-8);attempt--){
      const previous=readApi(`actions/runs/${latest.id}/attempts/${attempt}`);
      if(!eligible(previous)||String(previous.id)!==String(latest.id)||Number(previous.run_attempt)!==attempt||previous.head_sha!==latest.head_sha||previous.event!==latest.event)throw new Error('Prior attempt identity is unavailable.');
      attempts.push(previous);
    }
    const inventories=attempts.map(run=>{
      const result=readApi(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
      if(!Array.isArray(result.jobs)||result.total_count!==result.jobs.length)throw new Error('CI producer job inventory is incomplete.');
      const belongs=job=>String(job.run_id)===String(run.id)&&String(job.run_attempt)===String(run.run_attempt)&&job.head_sha===run.head_sha;
      const contexts=result.jobs.filter(job=>job.name==='validation-context'&&belongs(job));
      let context;
      if(contexts.length===1&&contexts[0].status==='completed'&&contexts[0].conclusion==='success'){
        const steps=(contexts[0].steps||[]).filter(successful);
        const checkouts=steps.map(step=>step.name.match(/^Actual checkout ([a-f0-9]{40}) tree ([a-f0-9]{40})$/)).filter(Boolean);
        const sources=steps.map(step=>step.name.match(/^Validation source ([a-f0-9]{40}) base ([a-f0-9]{40})$/)).filter(Boolean);
        if(checkouts.length===1&&sources.length===1&&checkouts[0][2]===inputs.checkoutTree&&sources[0][1]===run.head_sha&&sources[0][2]===inputs.comparisonBase)context={checkoutSha:checkouts[0][1]};
      }
      return {run,jobs:result.jobs.filter(belongs),contexts:contexts.length,context};
    });
    for(const inventory of inventories){
      const {run,jobs}=inventory;
      // Subset retries omit successful dependencies. Their immutable run event
      // retains the earlier validation context; they still contribute failures
      // even when that context cannot be recovered.
      const context=inventory.context||(inventory.contexts===0?inventories.find(previous=>Number(previous.run.run_attempt)<Number(run.run_attempt)&&previous.context)?.context:null);
      for(const gate of CI_GATES){
        const matches=jobs.filter(job=>job.name===(['rules','compatibility'].includes(gate)?'event-gates':'regression-'+gate));
        const admissionName=`Execute CI gate ${gate} input ${record.inputKeys[gate]}`;
        if(!matches.some(job=>(job.steps||[]).some(step=>successful(step)&&step.name===admissionName)))continue;
        const observation={start:NaN,end:NaN};observations[gate].push(observation);
        if(matches.length!==1)continue;
        const job=matches[0],admissions=(job.steps||[]).filter(step=>successful(step)&&step.name===admissionName);
        if(admissions.length!==1)continue;
        const jobStart=timestamp(job.started_at),jobEnd=timestamp(job.completed_at);
        observation.start=timestamp(admissions[0].completed_at);observation.end=jobEnd;
        if(!(jobStart<=observation.start&&observation.start<=jobEnd)){observation.start=NaN;continue;}
        if(!context)continue;
        const checkoutSha=context.checkoutSha;
        if(!commits.has(checkoutSha))commits.set(checkoutSha,readApi(`git/commits/${checkoutSha}`));
        const commit=commits.get(checkoutSha);
        if(commit.sha!==checkoutSha||commit.tree?.sha!==inputs.checkoutTree||(run.event==='push'?checkoutSha!==run.head_sha:commit.parents?.length!==2||commit.parents[0]?.sha!==inputs.comparisonBase||commit.parents[1]?.sha!==run.head_sha))continue;
        if(!decimal(job.id)||job.status!=='completed'||!(job.conclusion==='success'||(['rules','compatibility'].includes(gate)&&job.conclusion==='failure')))continue;
        const markers=(job.steps||[]).filter(step=>successful(step)&&new RegExp(`^Completed CI gate ${gate} input ${record.inputKeys[gate]} result [a-f0-9]{64}$`).test(step.name));
        if(markers.length!==1)continue;
        const completion=timestamp(markers[0].completed_at);
        if(!(observation.start<=completion&&completion<=jobEnd))continue;
        observation.end=completion;observation.job=job;
        observation.pass={kind:'ci-input-pass-v1',inputs,inputKey:record.inputKeys[gate],gate,coveredBy:{runId:String(run.id),runAttempt:String(run.run_attempt),jobId:String(job.id),sourceSha:run.head_sha,checkoutSha,checkoutTree:inputs.checkoutTree,comparisonBase:inputs.comparisonBase,resultSha256:markers[0].name.split(' result ')[1]}};
      }
    }
  }
  // Run IDs describe creation order. An old run can be retried after a newer
  // pass; only a successful execution strictly after every failure is reusable.
  for(const gate of CI_GATES){
    const known=observations[gate];
    if(known.some(item=>!Number.isFinite(item.start)||!Number.isFinite(item.end)))continue;
    const candidate=known.filter(item=>item.pass).sort((a,b)=>b.end-a.end)[0];
    if(candidate&&known.every(item=>item.pass||item.end<candidate.start)){
      try{Object.assign(candidate.pass.coveredBy,verifyArtifact(candidate.pass,candidate.job));passes[gate]=candidate.pass;}
      catch{/* Unretained or unreadable original proof requires execution. */}
    }
  }
  return passes;
}

function flags(argv) {
  const result = {};
  for (let i=0;i<argv.length;i+=2) {
    const key=argv[i],value=argv[i+1];
    if(!/^--[a-z][a-z-]*$/.test(key||'')||!value||value.startsWith('--')||Object.hasOwn(result,key))throw new Error('Pass distinct named options with values.');
    result[key]=value;
  }
  return result;
}

function main() {
  const [command,...argv]=process.argv.slice(2),options=flags(argv);
  if(command==='select'){
    const proof=selectRuntime(JSON.parse(readFileSync(options['--proof'],'utf8')));
    const target=path.resolve(options['--output-file']||'');
    if(!options['--output-file']||target.startsWith(process.cwd()+path.sep))throw new Error('Selected routing requires an output file outside the checkout.');
    mkdirSync(path.dirname(target),{recursive:true,mode:0o700});writeFileSync(target,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
    const output=`decision=${proof.decision}\nreused=${JSON.stringify(Object.keys(proof.inputPasses||{}))}\ninput-keys=${JSON.stringify(proof.inputKeys)}\n`;
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);process.stdout.write(output);return;
  }
  if(command==='run-gate')return runGate(options);
  if(command!=='run-group')throw new Error('Expected run-group.');
  if(!options['--proof']||!CI_GATES.slice(0,4).includes(options['--group']))throw new Error('run-group requires a routing proof and stable group.');
  const proof=selectRuntime(JSON.parse(readFileSync(options['--proof'],'utf8')));
  if(!['full','reuse'].includes(proof.decision))throw new Error('Routing did not admit required execution or verified coverage.');
  const covered=proof.decision==='reuse'||Boolean(proof.inputPasses?.[options['--group']]);
  const args=argv.filter((_value,index)=>!(!covered&&(argv[index]==='--proof'||argv[index-1]==='--proof')));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../test-groups.mjs',import.meta.url)),...args,...(covered?['--covered']:[])],{stdio:'inherit'});
  if(result.error||result.signal)throw new Error('Required group did not complete: '+(result.error?.message||result.signal));
  process.exitCode=result.status??1;
  if(process.exitCode===0){
    const evidence=readFileSync(path.join(options['--output-dir'],'result.json'));
    const report=JSON.parse(evidence);
    if(report.status!==(covered?'covered':'passed'))throw new Error('The required group did not produce the expected outcome.');
    let output=`mode=${covered?'covered':'executed'}\n`;
    if(!covered){
      const inputs=ciInputContext({...report.resultIdentity,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch}});
      if(inputs.runtime.imageOS&&inputs.runtime.imageVersion)output+=`key=${ciInputKey(inputs,options['--group'])}\nresult=${createHash('sha256').update(evidence).digest('hex')}\n`;
    }
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);
    process.stdout.write(output);
  }
}

function selectRuntime(proof){
  if(!['full','reuse'].includes(proof.decision))throw new Error('Routing did not admit execution or coverage.');
  const inputs=ciInputContext({...proof.validationContext,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch}});
  if(JSON.stringify(inputs.runtime)!==JSON.stringify(proof.inputContext?.runtime)||!inputs.runtime.imageOS||!inputs.runtime.imageVersion){
    proof={...proof,decision:'full',inputContext:inputs,inputKeys:Object.fromEntries(CI_GATES.map(gate=>[gate,ciInputKey(inputs,gate)])),inputPasses:{},runtimeMiss:'The consuming runtime differs or is unknown; execute required gates.'};
  }
  return proof;
}

function runGate(options) {
  const gate=options['--gate'];
  if(!['rules','compatibility'].includes(gate)||!options['--proof']||!options['--output-dir']||!sha(options['--comparison-base']))throw new Error('run-gate requires rules|compatibility, routing proof, output directory and exact comparison base.');
  const git=(...args)=>{
    const result=spawnSync('git',args,{encoding:'utf8',maxBuffer:1024*1024});
    if(result.status!==0||result.error)throw new Error('Cannot bind emulator gate checkout.');return result.stdout.trim();
  };
  const proof=selectRuntime(JSON.parse(readFileSync(options['--proof'],'utf8')));
  const identity={repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,
    sourceSha:process.env.CHAIN_TEST_SOURCE_SHA||process.env.GITHUB_SHA,checkoutSha:git('rev-parse','HEAD'),checkoutTree:git('rev-parse','HEAD^{tree}'),comparisonBase:options['--comparison-base'],selectedGroup:gate,checkoutDirty:Boolean(git('status','--porcelain'))};
  identity.sourceTree=git('rev-parse',`${identity.sourceSha}^{tree}`);
  if(identity.checkoutDirty||identity.checkoutSha!==process.env.GITHUB_SHA||!['full','reuse'].includes(proof.decision)||String(proof.runId)!==identity.runId||String(proof.runAttempt)!==identity.runAttempt)throw new Error('Emulator gate requires clean exact current-run routing.');
  for(const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase'])if(proof.validationContext?.[key]!==identity[key])throw new Error('Emulator gate context mismatch: '+key);
  const outputDir=path.resolve(options['--output-dir']);
  const root=git('rev-parse','--show-toplevel');
  if(outputDir===root||outputDir.startsWith(root+path.sep))throw new Error('Emulator gate evidence must be outside the checkout.');
  mkdirSync(path.dirname(outputDir),{recursive:true,mode:0o700});mkdirSync(outputDir,{mode:0o700});
  const inputs=ciInputContext({...identity,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch}});
  let report;
  if(proof.inputPasses?.[gate]){
    report={status:'covered',resultIdentity:identity,coverage:validateInputPass(proof.inputPasses[gate],identity),process:null};
  }else{
    const result=spawnSync('npm',['run',gate==='rules'?'test:rules':'test:compatibility'],{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,COMPATIBILITY_BASE_SHA:identity.comparisonBase}});
    const stdout=result.stdout||'',stderr=result.stderr||'';process.stdout.write(stdout);process.stderr.write(stderr);
    writeFileSync(path.join(outputDir,'stdout.tap'),stdout);writeFileSync(path.join(outputDir,'stderr.log'),stderr);
    const count=name=>Number([...stdout.matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))].at(-1)?.[1]??NaN);
    const complete=result.status===0&&!result.error&&!result.signal&&count('tests')>=(gate==='rules'?24:15)&&count('pass')===count('tests')&&['fail','cancelled','skipped'].every(name=>count(name)===0);
    report={status:complete?'passed':'failed',resultIdentity:identity,inputs,process:{exitCode:result.status,signal:result.signal,error:result.error?.message||null,
      stdoutSha256:createHash('sha256').update(stdout).digest('hex'),stderrSha256:createHash('sha256').update(stderr).digest('hex')},tests:count('tests'),passed:count('pass')};
  }
  const bytes=JSON.stringify(report,null,2)+'\n';writeFileSync(path.join(outputDir,'result.json'),bytes);
  if(report.status==='failed')throw new Error('Required emulator gate failed or did not execute its complete zero-skip cohort.');
  let output=`mode=${report.status==='covered'?'covered':'executed'}\n`;
  if(report.status==='passed'&&inputs.runtime.imageOS&&inputs.runtime.imageVersion)output+=`key=${ciInputKey(inputs,gate)}\nresult=${createHash('sha256').update(bytes).digest('hex')}\n`;
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);process.stdout.write(output);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error('ci-pass-reuse: '+error.message);process.exitCode=1;}
}
