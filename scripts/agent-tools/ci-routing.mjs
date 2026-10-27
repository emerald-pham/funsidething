#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { derivePolicyProseImpact, validatePolicyProseStatuses, verifyDeploymentEvidence } from '../release-evidence.mjs';
import { CI_GATES, ciInputContext, ciInputKey, findInputPasses } from './ci-pass-reuse.mjs';
import { originalArtifactVerifier, originalEarlyVerifier, verifyOriginalAggregate } from './ci-pass-artifacts.mjs';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const decimal = value => /^[1-9][0-9]*$/.test(String(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const workflowPath = '.github/workflows/data-safety.yml';

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!['comparison-base', 'evidence-dir', 'max-wait-ms', 'poll-interval-ms', 'descriptor', 'plan-only', 'require-input-passes', 'input-proof', 'resume'].includes(key) || !value || result[key]) throw new Error('Pass --comparison-base SHA --evidence-dir NEW_DIRECTORY.');
    result[key] = value;
  }
  if (result.resume && !result['comparison-base']) result['comparison-base'] = JSON.parse(readFileSync(result.resume, 'utf8')).validationContext?.comparisonBase;
  if (!sha(result['comparison-base']) || !result['evidence-dir']) throw new Error('An exact comparison base and fresh evidence directory are required.');
  result.maxWaitMs = result['max-wait-ms'] === undefined ? 900000 : Number(result['max-wait-ms']);
  result.pollIntervalMs = result['poll-interval-ms'] === undefined ? 30000 : Number(result['poll-interval-ms']);
  if (!Number.isInteger(result.maxWaitMs) || result.maxWaitMs < 0 || result.maxWaitMs > 900000 || !Number.isInteger(result.pollIntervalMs) || result.pollIntervalMs < 1 || result.pollIntervalMs > 60000) throw new Error('Invalid bounded producer wait.');
  return result;
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error(`Could not bind checkout identity: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

function context(repository, sourceSha, sourceTree, checkoutSha, checkoutTree, comparisonBase, eventPolicy) {
  return { repository, sourceSha, sourceTree, checkoutSha, checkoutTree, comparisonBase, eventPolicy,
    // The exact committed tree binds all test commands, inventory, assignments,
    // workflow and browser dependency versions; the policy names the full cohort.
    requiredCohort: 'complete-npm-test-v1', runtime: { node: process.versions.node, platform: process.platform, arch: process.arch } };
}

async function main() {
  const args = options(process.argv.slice(2));
  if (args.resume) {
    const previous = JSON.parse(readFileSync(args.resume, 'utf8'));
    for (const [key, value] of Object.entries(previous.observationEnvironment || {})) {
      if (['GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_SHA'].includes(key) && process.env[key] === undefined) process.env[key] = value;
    }
    if (!process.env.GITHUB_EVENT_PATH) process.env.GITHUB_EVENT_PATH = path.join(path.dirname(path.resolve(args.resume)), 'event.json');
    if (!args.descriptor && previous.descriptorFile === 'descriptor.json') args.descriptor = path.join(path.dirname(path.resolve(args.resume)), 'descriptor.json');
  }
  const directory = path.resolve(args['evidence-dir']);
  mkdirSync(directory, { mode: 0o700 });
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY must identify the current repository.');
  if (!decimal(process.env.GITHUB_RUN_ID) || !decimal(process.env.GITHUB_RUN_ATTEMPT)) throw new Error('Current run and attempt identities are required.');
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!['push', 'pull_request'].includes(eventName)) throw new Error('Unknown workflow event policy.');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const sourceSha = eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  const checkoutSha = git('rev-parse', 'HEAD');
  if (!sha(sourceSha) || checkoutSha !== process.env.GITHUB_SHA || (eventName === 'push' && sourceSha !== checkoutSha)) throw new Error('Source or actual checkout identity is unavailable or inconsistent.');
  const sourceTree = git('rev-parse', `${sourceSha}^{tree}`), checkoutTree = git('rev-parse', 'HEAD^{tree}');
  if (!sha(sourceTree) || !sha(checkoutTree) || git('status', '--porcelain', '--untracked-files=no')) throw new Error('Routing requires a clean exact committed checkout.');
  const isMain = eventName === 'push' && process.env.GITHUB_REF === 'refs/heads/main';
  let cohort = null;
  if (args.descriptor) {
    const descriptor = JSON.parse(readFileSync(args.descriptor,'utf8')), identity=descriptor.resultIdentity;
    for (const [key,value] of Object.entries({repository,sourceSha,sourceTree,checkoutSha,checkoutTree,comparisonBase:args['comparison-base'],runId:process.env.GITHUB_RUN_ID})) {
      if (identity?.[key] !== value) throw new Error(`Descriptor identity mismatch: ${key}.`);
    }
    if (String(identity.runAttempt)!==process.env.GITHUB_RUN_ATTEMPT || identity.checkoutDirty || !/^[a-f0-9]{64}$/.test(identity.cohortDigestSha256) || JSON.stringify(identity.expectedGroups)!==JSON.stringify(['core','scenery','persistence-recovery','native-process'])) throw new Error('Invalid complete cohort descriptor.');
    cohort={requiredCohort:'four-groups-v1',cohortDigestSha256:identity.cohortDigestSha256,inventorySha256:identity.inventorySha256,assignmentsSha256:identity.assignmentsSha256,expectedGroups:identity.expectedGroups,workflowBlob:git('rev-parse',`${checkoutSha}:${workflowPath}`)};
  }
  const earlyRequired=Boolean(cohort&&git('ls-tree','--name-only',checkoutSha,'scripts/early-ci-harness-source.json'));
  if(earlyRequired)cohort.earlyPolicy='saved-harness-required-mobile-v1';
  const boundContext = (...values) => ({...context(...values),...(cohort||{})});
  const validationContext = boundContext(repository, sourceSha, sourceTree, checkoutSha, checkoutTree, args['comparison-base'],
    eventName === 'pull_request' ? 'canonical-pr-merge-v1' : isMain ? 'exact-main-push-v1' : 'outgoing-branch-push-v1');
  const record = { schemaVersion: 1, eventName, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    validationContext, cohortContext: validationContext, contextSha256: hash(validationContext), decision: 'full',
    reason: isMain ? 'Exact main requires execution or verified original passes for complete inputs.' : 'No verified equivalent producer.', coveredBy: null, observations: [] };
  // Persist only routing inputs, never PR prose or token-bearing environment.
  // Together with the descriptor these restore a fresh observer process after
  // interruption; all claimed context and producer evidence is verified again.
  record.observationEnvironment = Object.fromEntries(['GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_SHA'].map(key => [key, process.env[key]]));
  const savedEvent = eventName === 'pull_request' ? {action: event.action, number: event.number,
    changes: event.changes?.base ? {base: true} : {}, pull_request: {head: {sha: sourceSha, ref: event.pull_request?.head?.ref}}} : {after: sourceSha};
  writeFileSync(path.join(directory, 'event.json'), JSON.stringify(savedEvent) + '\n', {mode: 0o600});
  if (args.descriptor) { writeFileSync(path.join(directory, 'descriptor.json'), readFileSync(args.descriptor), {mode: 0o600}); record.descriptorFile = 'descriptor.json'; }
  let boundProducer = null;
  if (args.resume) {
    const previousBytes = readFileSync(args.resume), previous = JSON.parse(previousBytes);
    if (eventName !== 'pull_request' || event.action !== 'edited' || event.changes?.base
      || previous.schemaVersion !== 1 || hash(previous.validationContext) !== hash(validationContext)
      || previous.contextSha256 !== hash(previous.cohortContext)
      || !decimal(previous.coveredBy?.runId) || !decimal(previous.coveredBy?.runAttempt)
      || !['pending','unresolved','fail','cancelled','reuse'].includes(previous.decision)) throw new Error('Saved observation does not bind this complete metadata context.');
    boundProducer = {runId: previous.coveredBy.runId, runAttempt: previous.coveredBy.runAttempt};
    record.coveredBy = previous.coveredBy; record.producerOutcome = previous.producerOutcome;
    if(previous.producerKind)record.producerKind=previous.producerKind;
    record.resumedFrom = {path: path.resolve(args.resume), sha256: createHash('sha256').update(previousBytes).digest('hex')};
  }
  record.inputContext = ciInputContext(validationContext);
  record.inputKeys = Object.fromEntries(CI_GATES.map(gate => [gate, ciInputKey(record.inputContext, gate)]));
  record.inputPasses = {};
  if(args['input-proof']){
    const original=JSON.parse(readFileSync(args['input-proof'],'utf8'));
    if(String(original.runId)!==record.runId||String(original.runAttempt)!==record.runAttempt)throw new Error('Original routing run/attempt changed.');
    for(const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase'])if(original.validationContext?.[key]!==validationContext[key])throw new Error('Original routing context changed: '+key);
    const inputs={...ciInputContext(validationContext),runtime:original.inputContext?.runtime};
    if(JSON.stringify(inputs)!==JSON.stringify(original.inputContext)||!inputs.runtime)throw new Error('Original routing input identity is incomplete.');
    record.inputContext=inputs;record.inputKeys=Object.fromEntries(CI_GATES.map(gate=>[gate,ciInputKey(inputs,gate)]));
  }
  let apiReads = 0;
  function readApi(suffix, archive=false) {
    if (++apiReads > 96) throw new Error('Public observation request budget exhausted.');
    const url = `https://api.github.com/repos/${repository}/${suffix}`;
    const response = spawnSync('curl', ['--disable', '--fail', '--silent', '--show-error', '--max-time', archive?'45':'10', '--connect-timeout', '5',
      ...(archive?['--location','--proto','=https','--proto-redir','=https','--max-filesize','134217728']:[]),
      ...(process.env.GITHUB_TOKEN?['--header','Authorization: Bearer '+process.env.GITHUB_TOKEN]:[]),
      '--header', 'Accept: application/vnd.github+json', '--header', 'User-Agent: chain-scanner-ci-routing', url],
    { encoding: archive?undefined:'utf8', timeout: archive?46000:11000, maxBuffer: (archive?128:8) * 1024 * 1024 });
    const evidence = `observation-${apiReads}.${archive?'zip':'json'}`;
    writeFileSync(path.join(directory, evidence), response.stdout || response.stderr || response.error?.message || '', { mode: 0o600 });
    record.observations.push({ url, evidence, exitCode: response.status, observedAt: new Date().toISOString() });
    if (response.status !== 0 || response.error) throw new Error('Public GitHub observation unavailable.');
    if(archive)return {path:path.join(directory,evidence),sha256:createHash('sha256').update(response.stdout).digest('hex')};
    return JSON.parse(response.stdout);
  }
  function canonicalPull() {
    const branch = eventName === 'pull_request' ? event.pull_request?.head?.ref : process.env.GITHUB_REF?.replace(/^refs\/heads\//, '');
    if (!branch || (eventName === 'push' && !process.env.GITHUB_REF?.startsWith('refs/heads/'))) throw new Error('Unknown source branch.');
    let number = event.number;
    if (eventName === 'push') {
      const pulls = readApi(`pulls?state=open&head=${encodeURIComponent(repository.split('/')[0] + ':' + branch)}&per_page=100`);
      if (!Array.isArray(pulls) || pulls.length !== 1) throw new Error('No unique open PR for this branch.');
      number = pulls[0]?.number;
    }
    if (!decimal(number)) throw new Error('Open PR number is unavailable.');
    const pull = readApi(`pulls/${number}`);
    if (pull.number !== number) throw new Error('PR detail identity changed.');
    if (pull.state !== 'open' || !decimal(pull.number) || pull.mergeable !== true || !sha(pull.merge_commit_sha)
      || pull.head?.sha !== sourceSha || pull.head?.ref !== branch || pull.head?.repo?.full_name !== repository
      || pull.base?.repo?.full_name !== repository || !sha(pull.base?.sha)) throw new Error('Open PR identity or merge state is uncertain.');
    const merge = readApi(`git/commits/${pull.merge_commit_sha}`);
    if (merge.sha !== pull.merge_commit_sha || !sha(merge.tree?.sha) || merge.parents?.length !== 2
      || merge.parents[0]?.sha !== pull.base.sha || merge.parents[1]?.sha !== sourceSha) throw new Error('PR merge does not bind the exact base and source parents.');
    if (cohort) {
      const tree=readApi(`git/trees/${merge.tree.sha}?recursive=1`);
      if(tree.truncated || !Array.isArray(tree.tree))throw new Error('Canonical workflow/cohort tree is incomplete.');
      for(const file of [workflowPath,'scripts/test-group-inventory.json','scripts/test-group-assignments.json','scripts/test-groups.mjs','scripts/agent-tools/ci-routing.mjs']) {
        const entries=tree.tree.filter(item=>item.path===file&&item.type==='blob');
        if(entries.length!==1||entries[0].sha!==git('rev-parse',`${checkoutSha}:${file}`))throw new Error('Canonical producer has a different cohort or workflow definition.');
      }
    }
    return { pull, cohort: boundContext(repository, sourceSha, sourceTree, merge.sha, merge.tree.sha, pull.base.sha, 'canonical-pr-merge-v1') };
  }
  async function reviewedProductOrigin(base,baseTree){
    const observed=new Map(),prefix=`https://api.github.com/repos/${repository}/`;
    const binding=await verifyDeploymentEvidence({repository,deployedSha:base,beforeSha:git('rev-parse',`${base}^`),token:process.env.GITHUB_TOKEN||'public-read-only-observer',repoRoot:process.cwd(),fetchImpl:async url=>{
      if(!url.startsWith(prefix))throw new Error('Unexpected original-review observation URL.');const suffix=url.slice(prefix.length),value=readApi(suffix);observed.set(suffix,value);return{ok:true,status:200,json:async()=>value};
    }});
    if(!binding.ok)throw new Error('Reviewed full-product origin unavailable: '+binding.errors.join(' '));
    const head=binding.reviewedSha,originalBase=binding.baseSha,statuses=observed.get(`commits/${head}/statuses?per_page=100`),associated=observed.get(`commits/${base}/pulls?per_page=100`);
    const merged=associated.filter(pull=>pull.merge_commit_sha===base&&pull.head?.sha===head&&pull.base?.sha===originalBase&&pull.base?.ref==='main'&&pull.head?.repo?.full_name===repository&&pull.base?.repo?.full_name===repository&&pull.merged_at);
    if(merged.length!==1||git('rev-parse',`${head}^{tree}`)!==baseTree||!Array.isArray(statuses)||['funsidething/memory-audit','funsidething/independent-review','funsidething/specialist-review'].some(context=>!/^r=[a-f0-9]{64};b=[a-f0-9]{40};p=[a-f0-9]{12};c=[01];s=[01];v=3$/.test(statuses.find(status=>status.context===context)?.description||'')))throw new Error('Policy origin needs an exact merged full FAQ-reviewed product receipt.');
    const inventory=readApi(`actions/workflows/data-safety.yml/runs?head_sha=${head}&per_page=20`);
    if(!Array.isArray(inventory.workflow_runs)||inventory.total_count!==inventory.workflow_runs.length)throw new Error('Original reviewed full-run inventory is incomplete.');
    for(const run of inventory.workflow_runs.slice(0,16)){
      if(run.head_sha!==head||!['push','pull_request'].includes(run.event)||run.status!=='completed'||run.conclusion!=='success'||run.name!=='Data safety'||run.path!==workflowPath||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository||!decimal(run.id)||!decimal(run.run_attempt))continue;
      const result=readApi(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
      if(!Array.isArray(result.jobs)||result.total_count!==result.jobs.length)continue;
      const completed=name=>result.jobs.filter(job=>job.name===name&&job.status==='completed'&&job.conclusion==='success'&&String(job.run_id)===String(run.id)&&String(job.run_attempt)===String(run.run_attempt)&&job.head_sha===head);
      const required=['validation-context','event-gates','cohort-routing',...(earlyRequired?['early-startup','mobile-stress']:[]),...cohort.expectedGroups.map(group=>'regression-'+group),'scanner-tests'];
      if(required.some(name=>completed(name).length!==1)||result.jobs.some(job=>!required.includes(job.name)&&!['release-evidence','deploy-pages'].includes(job.name)))continue;
      const steps=name=>(completed(name)[0].steps||[]).filter(step=>step.status==='completed'&&step.conclusion==='success');
      const checkouts=steps('validation-context').map(step=>step.name.match(/^Actual checkout ([a-f0-9]{40}) tree ([a-f0-9]{40})$/)).filter(Boolean);
      if(checkouts.length!==1||checkouts[0][2]!==baseTree)continue;
      // The retained original receipt supplies its own runtime. A later policy
      // observation may run on another image without pretending to execute it.
      if(steps('scanner-tests').filter(step=>/^Complete regression context [a-f0-9]{64} report [a-f0-9]{64}$/.test(step.name)).length!==1)continue;
      const context=boundContext(repository,head,baseTree,checkouts[0][1],baseTree,originalBase,run.event==='pull_request'?'canonical-pr-merge-v1':'outgoing-branch-push-v1');
      const early=earlyRequired?originalEarlyVerifier(readApi)(context,run,result.jobs,null):null;
      if(early)context.runtime=Object.fromEntries(['node','platform','arch'].map(key=>[key,early.inputs.runtime[key]]));
      const contextSha256=hash(context);
      if([`Announce regression context ${contextSha256}`,`Validation source ${head} base ${originalBase}`,`Workflow blob ${cohort.workflowBlob} policy four-groups-v1`].some(name=>steps('validation-context').filter(step=>step.name===name).length!==1)||steps('cohort-routing').filter(step=>step.name===`Admit original full producer context ${contextSha256}`).length!==1)continue;
      const markers=steps('scanner-tests').filter(step=>new RegExp(`^Complete regression context ${contextSha256} report [a-f0-9]{64}$`).test(step.name));if(markers.length!==1)continue;
      const inputs=early?.inputs||ciInputContext(context),inputKeys=Object.fromEntries(CI_GATES.map(gate=>[gate,ciInputKey(inputs,gate)])),retained=findInputPasses({...record,validationContext:context,inputContext:inputs,inputKeys},readApi,originalArtifactVerifier(readApi));
      if(CI_GATES.some(gate=>retained[gate]?.coveredBy.runId!==String(run.id)||retained[gate]?.coveredBy.runAttempt!==String(run.run_attempt)))continue;
      const aggregate=verifyOriginalAggregate(readApi,{context,run,job:completed('scanner-tests')[0],reportSha256:markers[0].name.split(' report ')[1],retained,early});
      return{context,contextSha256,retained,originReview:{...binding,mergedPullRequest:merged[0].number},originStatuses:statuses,coveredBy:{runId:String(run.id),runAttempt:String(run.run_attempt),checkoutSha:context.checkoutSha,checkoutTree:baseTree,comparisonBase:originalBase,reportSha256:markers[0].name.split(' report ')[1],aggregateArtifact:aggregate,...(early?{earlyReportSha256:early.coveredBy.earlyReportSha256,earlyOrigin:early}: {})}};
    }
    throw new Error('No retained original full execution for the exact reviewed product source.');
  }
  // Prove the complete unchanged inventory before looking for inherited
  // execution. Current policy reviews are never inherited from the producer.
  if (!args['plan-only'] && !args.resume && cohort) {
    let policyCandidate=null;
    try {
      const impact = derivePolicyProseImpact(process.cwd(), sourceSha, args['comparison-base']);
      if (impact) {
        if (checkoutTree !== sourceTree) throw new Error('Policy checkout and reviewed source trees differ.');
        let reviewedSha = sourceSha;
        if (isMain) {
          const pulls = readApi(`commits/${sourceSha}/pulls?per_page=100`);
          const merged = Array.isArray(pulls) ? pulls.filter(pull => pull.merge_commit_sha === sourceSha && pull.merged_at && pull.base?.ref === 'main' && sha(pull.head?.sha)) : [];
          if (merged.length !== 1 || git('rev-parse', `${merged[0].head.sha}^{tree}`) !== sourceTree) throw new Error('Policy main has no unique exact reviewed tree.');
          reviewedSha = merged[0].head.sha;
        }
        const policyStatuses = readApi(`commits/${reviewedSha}/statuses?per_page=100`);
        const review = validatePolicyProseStatuses(process.cwd(), reviewedSha, args['comparison-base'], policyStatuses);
        policyCandidate={impact,review,policyStatuses,reviewedSha};
        const base = args['comparison-base'], baseTree = git('rev-parse', `${base}^{tree}`), parent = git('rev-parse', `${base}^`);
        const producerContext = boundContext(repository, base, baseTree, base, baseTree, parent, 'exact-main-push-v1');
        const expected = hash(producerContext);
        const response = readApi(`actions/workflows/data-safety.yml/runs?head_sha=${base}&event=push&branch=main&per_page=20`);
        if (!Array.isArray(response.workflow_runs) || response.total_count !== response.workflow_runs.length) throw new Error('Policy base producer inventory is incomplete.');
        const runs = response.workflow_runs.filter(run => run.event === 'push' && run.head_branch === 'main' && run.head_sha === base && run.name === 'Data safety' && run.path === workflowPath && run.repository?.full_name === repository && run.head_repository?.full_name === repository).sort((a,b)=>Number(b.id)-Number(a.id));
        const run = runs[0];
        if (!run || !decimal(run.id) || !decimal(run.run_attempt) || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('No successful current full exact-base producer.');
        const result = readApi(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        const required = ['validation-context','event-gates','cohort-routing',...(earlyRequired?['early-startup','mobile-stress']:[]),...cohort.expectedGroups.map(id=>'regression-'+id),'scanner-tests'];
        if (!Array.isArray(result.jobs) || result.total_count !== result.jobs.length || required.some(name => result.jobs.filter(job=>job.name===name && job.status==='completed' && job.conclusion==='success' && String(job.run_id)===String(run.id) && String(job.run_attempt)===String(run.run_attempt) && job.head_sha===base).length!==1) || result.jobs.some(job=>!required.includes(job.name) && !['release-evidence','deploy-pages'].includes(job.name))) throw new Error('Policy base full topology is incomplete.');
        const completed = name => result.jobs.find(job=>job.name===name)?.steps?.filter(step=>step.status==='completed' && step.conclusion==='success') || [];
        for (const name of [`Announce regression context ${expected}`,`Actual checkout ${base} tree ${baseTree}`,`Validation source ${base} base ${parent}`,`Workflow blob ${cohort.workflowBlob} policy four-groups-v1`]) if (completed('validation-context').filter(step=>step.name===name).length!==1) throw new Error('Policy base context does not match the frozen complete cohort.');
        const producerInputs=ciInputContext(producerContext),producerKeys=Object.fromEntries(CI_GATES.map(gate=>[gate,ciInputKey(producerInputs,gate)]));
        for (const [gate,legacy] of [['rules','Run npm run test:rules'],['compatibility','Backward compatibility']]) {
          const steps=completed('event-gates');
          const keyed=steps.filter(step=>step.name===`Execute CI gate ${gate} input ${producerKeys[gate]}`).length===1&&steps.filter(step=>new RegExp(`^Completed CI gate ${gate} input ${producerKeys[gate]} result [a-f0-9]{64}$`).test(step.name)).length===1;
          if(!keyed&&(args['require-input-passes']==='1'||steps.filter(step=>step.name===legacy).length!==1))throw new Error('Policy base rules or compatibility execution is absent.');
        }
        for (const group of cohort.expectedGroups) if (completed('regression-'+group).filter(step=>step.name==='Execute complete assigned group').length!==1) throw new Error('Policy base producer did not execute every group.');
        const earlyMarkers=earlyRequired?completed('early-startup').filter(step=>/^Complete early startup report [a-f0-9]{64}$/.test(step.name)):[];
        if(earlyRequired&&earlyMarkers.length!==1)throw new Error('Original complete early execution receipt is absent.');
        const markers = completed('scanner-tests').filter(step=>new RegExp(`^Complete regression context ${expected} report [a-f0-9]{64}$`).test(step.name));
        if (markers.length !== 1) throw new Error('Policy base full reconciliation attestation is absent.');
        if(args['require-input-passes']==='1'){
          const retained=findInputPasses({...record,validationContext:producerContext,inputContext:producerInputs,inputKeys:producerKeys},readApi,originalArtifactVerifier(readApi));
          if(CI_GATES.some(gate=>retained[gate]?.coveredBy.runId!==String(run.id)||retained[gate]?.coveredBy.runAttempt!==String(run.run_attempt)))throw new Error('Policy inheritance requires six retained original passes from the exact full-product producer.');
          record.policyInputPasses=retained;
          const early=earlyRequired?originalEarlyVerifier(readApi)(producerContext,run,result.jobs,producerInputs):null;
          record.policyAggregateArtifact=verifyOriginalAggregate(readApi,{context:producerContext,run,job:result.jobs.find(job=>job.name==='scanner-tests'),reportSha256:markers[0].name.split(' report ')[1],retained,early});
          if(early)record.policyEarlyOrigin=early;
        }
        // Re-read current statuses: changed or revoked evidence cannot be hidden
        // behind an earlier successful base execution observation.
        const currentReview = validatePolicyProseStatuses(process.cwd(), reviewedSha, base, readApi(`commits/${reviewedSha}/statuses?per_page=100`));
        if (JSON.stringify(review) !== JSON.stringify(currentReview)) throw new Error('Policy review changed during inheritance validation.');
        record.decision='policy-reuse'; record.reason='Instruction-preserving policy prose; unchanged product/FAQ/rendered evidence and full base execution verified.';
        record.policyImpact=impact; record.policyReview=review; record.policyStatuses=policyStatuses; record.cohortContext=producerContext; record.contextSha256=expected;
        record.coveredBy={runId:String(run.id),runAttempt:String(run.run_attempt),checkoutSha:base,checkoutTree:baseTree,comparisonBase:parent,reportSha256:markers[0].name.split(' report ')[1],...(record.policyAggregateArtifact?{aggregateArtifact:record.policyAggregateArtifact}:{}),...(record.policyEarlyOrigin?{earlyOrigin:record.policyEarlyOrigin}:{}),...(earlyRequired?{earlyReportSha256:earlyMarkers[0].name.split(' report ')[1]}:{})};
      }
    } catch (error) {
      if(policyCandidate&&args['require-input-passes']==='1'){
        try{
          const origin=await reviewedProductOrigin(args['comparison-base'],git('rev-parse',`${args['comparison-base']}^{tree}`));
          const current=validatePolicyProseStatuses(process.cwd(),policyCandidate.reviewedSha,args['comparison-base'],readApi(`commits/${policyCandidate.reviewedSha}/statuses?per_page=100`));if(JSON.stringify(current)!==JSON.stringify(policyCandidate.review))throw new Error('Current policy review changed during original-product validation.');
          Object.assign(record,{decision:'policy-reuse',reason:'Current policy review and the directly reviewed original full-product execution verified.',policyImpact:policyCandidate.impact,policyReview:policyCandidate.review,policyStatuses:policyCandidate.policyStatuses,policyOriginReview:origin.originReview,policyOriginStatuses:origin.originStatuses,policyInputPasses:origin.retained,cohortContext:origin.context,contextSha256:origin.contextSha256,coveredBy:origin.coveredBy});
        }catch(originError){record.reason=`${originError.message} Executing the actual checkout's required gates.`;}
      }else record.reason=`${error.message} Executing the actual checkout's complete cohort.`;
    }
  }
  const metadataEdit = eventName === 'pull_request' && event.action === 'edited' && !event.changes?.base;
  let observedEarlyOrigin=null;
  if (record.decision === 'full' && !args['plan-only'] && ((eventName === 'push' && !isMain) || metadataEdit)) {
    try {
      const canonical = canonicalPull();
      if (metadataEdit && (canonical.cohort.checkoutSha !== checkoutSha || canonical.cohort.checkoutTree !== checkoutTree || canonical.cohort.comparisonBase !== args['comparison-base'])) throw new Error('Edited PR has a different actual merge context.');
      const expected = hash(canonical.cohort);
      const deadline = Date.now() + args.maxWaitMs;
      while (true) {
      const response = readApi(`actions/workflows/data-safety.yml/runs?head_sha=${sourceSha}&event=pull_request&per_page=20`);
      if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count) || response.total_count !== response.workflow_runs.length) throw new Error('Producer observations are incomplete.');
      const runs = response.workflow_runs.filter(run => String(run.id) !== process.env.GITHUB_RUN_ID && run.event === 'pull_request' && run.head_sha === sourceSha
        && run.path === workflowPath && run.name === 'Data safety' && run.repository?.full_name === repository
        && run.head_repository?.full_name === repository && decimal(run.id) && decimal(run.run_attempt))
        .sort((a, b) => Number(b.id) - Number(a.id));
      let pending = false, mixedEarlyProducer = null;
      const candidates = boundProducer ? runs.filter(run => String(run.id) === String(boundProducer.runId) && String(run.run_attempt) === String(boundProducer.runAttempt)) : runs;
      if (boundProducer && candidates.length !== 1) throw new Error('Bound producer attempt is no longer verifiable in current observations.');
      for (const run of candidates) {
        const result = readApi(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        if (!Array.isArray(result.jobs) || result.total_count !== result.jobs.length) throw new Error('Producer jobs are incomplete.');
        const scanners = result.jobs.filter(job => job.name === 'scanner-tests');
        const scanner = scanners.length === 1 ? scanners[0] : null, steps = Array.isArray(scanner?.steps) ? scanner.steps : [];
        const earlyJobs=cohort ? result.jobs.filter(job=>job.name==='validation-context') : scanners;
        if(earlyJobs.length!==1)throw new Error('Producer announcement is missing or ambiguous.');
        const announcements=(earlyJobs[0].steps||[]).filter(step=>step.name===`Announce regression context ${expected}`&&step.conclusion==='success');
        if(announcements.length!==1)continue;
        for(const job of earlyJobs)if(String(job.run_id)!==String(run.id)||String(job.run_attempt)!==String(run.run_attempt)||job.head_sha!==sourceSha)throw new Error('Producer announcement attempt identity changed.');
        if (cohort) {
          const admissions = result.jobs.filter(job => job.name === 'cohort-routing');
          const marker = `Admit original full producer context ${expected}`;
          if (admissions.length !== 1 || (admissions[0].steps || []).filter(step => step.name === marker && step.status === 'completed' && step.conclusion === 'success').length !== 1) {
            if (boundProducer) throw new Error('Saved original producer admission is no longer verifiable.');
            continue;
          }
          if (String(admissions[0].run_id) !== String(run.id) || String(admissions[0].run_attempt) !== String(run.run_attempt) || admissions[0].head_sha !== sourceSha) throw new Error('Producer admission attempt identity changed.');
          record.producerAdmission = {contextSha256: expected, job: 'cohort-routing', step: marker};
        }
        const coveredAnnouncement = cohort && steps.some(step => new RegExp(`^Verified complete cohort ${expected} report [a-f0-9]{64} mode (reuse|policy-reuse)$`).test(step.name) && step.conclusion === 'success');
        if (coveredAnnouncement && !steps.some(step => step.name.startsWith('Complete regression context '))) {
          if(metadataEdit&&earlyRequired){mixedEarlyProducer={runId:String(run.id),runAttempt:String(run.run_attempt),checkoutSha:canonical.cohort.checkoutSha,checkoutTree:canonical.cohort.checkoutTree,comparisonBase:canonical.cohort.comparisonBase};observedEarlyOrigin={context:canonical.cohort,run,jobs:result.jobs};}
          else if (boundProducer) throw new Error('Bound producer is a coverage reference rather than original execution.');
          continue;
        }
        if (boundProducer && hash(canonical.cohort) !== record.contextSha256) throw new Error('Saved producer context changed.');
        boundProducer = {runId: String(run.id), runAttempt: String(run.run_attempt)};
        // Persist the exact admitted producer before waiting or inspecting its
        // terminal result. Pending, cancelled and incomplete runs remain that
        // producer's outcome; metadata never upgrades them to fresh execution.
        record.cohortContext = canonical.cohort; record.contextSha256 = expected;
        record.coveredBy = { runId: String(run.id), runAttempt: String(run.run_attempt),
          checkoutSha: canonical.cohort.checkoutSha, checkoutTree: canonical.cohort.checkoutTree,
          comparisonBase: canonical.cohort.comparisonBase };
        record.producerOutcome = {status: run.status, conclusion: run.conclusion ?? null};
        if (['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status)) {
          pending = true; record.decision = 'pending'; record.nextGate = 'resume-bound-producer-observation';
          record.reason = `Exact producer ${run.id}/${run.run_attempt} is ${run.status}; resume observation.`;
          writeFileSync(path.join(directory, 'routing.json'), JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
          break;
        }
        if (run.status !== 'completed') throw new Error('Unknown producer lifecycle.');
        if(metadataEdit && !['success','failure','cancelled','timed_out','action_required','stale','startup_failure'].includes(run.conclusion)) throw new Error('Unknown producer conclusion.');
        if(cohort&&run.conclusion!=='success') {
          record.decision=metadataEdit&&run.conclusion==='cancelled'?'cancelled':'fail';record.reason=`Exact producer ${run.id}/${run.run_attempt} concluded ${run.conclusion}.`;break;
        }
        if(!scanner)throw new Error('Producer aggregate is missing or ambiguous.');
        if (String(scanner.run_id) !== String(run.id) || String(scanner.run_attempt) !== String(run.run_attempt) || scanner.head_sha !== sourceSha) throw new Error('Producer attempt identity changed.');
        if (run.conclusion !== 'success' || scanner.conclusion !== 'success' || scanner.status !== 'completed') {
          record.decision = metadataEdit&&run.conclusion==='cancelled'?'cancelled':'fail'; record.reason = `Exact producer ${run.id}/${run.run_attempt} concluded ${run.conclusion}.`; break;
        }
        if(cohort){
          const required=['validation-context','event-gates','cohort-routing',...(earlyRequired?['early-startup','mobile-stress']:[]),...cohort.expectedGroups.map(id=>'regression-'+id),'scanner-tests'];
          if(required.some(name=>result.jobs.filter(job=>job.name===name&&job.status==='completed'&&job.conclusion==='success'&&String(job.run_id)===String(run.id)&&String(job.run_attempt)===String(run.run_attempt)&&job.head_sha===sourceSha).length!==1))throw new Error('Producer required topology is incomplete.');
          if(result.jobs.some(job=>!required.includes(job.name)&&!['release-evidence','deploy-pages'].includes(job.name)))throw new Error('Producer topology is unknown.');
        }
        const completed = steps.filter(step => (cohort ? new RegExp(`^Complete regression context ${expected} report [a-f0-9]{64}$`).test(step.name) : step.name === `Complete regression context ${expected}`) && step.conclusion === 'success');
        // Metadata-only edited runs can themselves be covered. They are never
        // producers: continue to the original completed full run instead.
        const coveredMarkers=cohort?steps.filter(step=>new RegExp(`^Verified complete cohort ${expected} report [a-f0-9]{64} mode reuse$`).test(step.name)&&step.conclusion==='success'):[];
        if(cohort&&completed.length===0&&coveredMarkers.length===1&&!steps.some(step=>step.name.startsWith('Complete regression context ')))continue;
        if (completed.length !== 1) throw new Error('The full cohort has no unique successful completion attestation.');
        if (hash(canonicalPull().cohort) !== expected) throw new Error('PR merge or base changed after producer validation.');
        record.decision = 'reuse'; record.reason = 'Exact canonical PR merge cohort already completed successfully.';
        record.cohortContext = canonical.cohort; record.contextSha256 = expected;
        record.coveredBy = { runId: String(run.id), runAttempt: String(run.run_attempt), checkoutSha: canonical.cohort.checkoutSha,
          checkoutTree: canonical.cohort.checkoutTree, comparisonBase: canonical.cohort.comparisonBase };
        if(cohort)record.coveredBy.reportSha256=completed[0].name.split(' report ')[1];
        if(earlyRequired){const early=result.jobs.find(job=>job.name==='early-startup'),markers=(early.steps||[]).filter(step=>step.conclusion==='success'&&/^Complete early startup report [a-f0-9]{64}$/.test(step.name));if(markers.length!==1)throw new Error('Original complete early execution receipt is absent.');record.coveredBy.earlyReportSha256=markers[0].name.split(' report ')[1];}
        if(metadataEdit&&earlyRequired)observedEarlyOrigin={context:canonical.cohort,run,jobs:result.jobs};
        break;
      }
      if(record.decision==='full'&&mixedEarlyProducer){
        record.decision='unresolved';record.producerKind='mixed-consumer';record.coveredBy=mixedEarlyProducer;
        record.reason='Equivalent mixed consumer retained; verify its original early execution before admitting another mobile story.';
      }
      if (!['full','pending'].includes(record.decision) || !pending || Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(args.pollIntervalMs, Math.max(0, deadline - Date.now()))));
      }
    } catch (error) {
      record.decision = metadataEdit && record.coveredBy ? 'unresolved' : 'full';
      if (record.decision === 'full') { record.coveredBy = null; delete record.producerOutcome; delete record.producerAdmission; }
      record.reason = record.decision === 'unresolved' ? `${error.message} Resume the bound producer observation.` : `${error.message} Executing the actual checkout's complete cohort.`;
    }
  }
  const canonicalCoverage=record.decision==='reuse'?{cohortContext:record.cohortContext,contextSha256:record.contextSha256,coveredBy:record.coveredBy}:null;
  if(!args['plan-only']&&args['require-input-passes']==='1'&&['full','reuse'].includes(record.decision)){
    record.reason='Required gates use verified retained original input passes; uncovered gates execute.';
    record.decision='full';record.coveredBy=null;record.cohortContext=validationContext;record.contextSha256=hash(validationContext);
  }
  if (!args['plan-only'] && record.decision !== 'policy-reuse') {
    try { record.inputPasses = findInputPasses(record, readApi,originalArtifactVerifier(readApi)); }
    catch (error) { record.inputReuseReason = `${error.message} Unverified gates require execution.`; }
  }
  // Complete canonical coverage can suppress a second early producer only
  // after every shipped gate has retained original-execution proof as well.
  if(canonicalCoverage&&args['require-input-passes']==='1'&&CI_GATES.every(gate=>record.inputPasses[gate])){
    Object.assign(record,canonicalCoverage,{decision:'reuse'});
  }
  if(observedEarlyOrigin&&args['require-input-passes']==='1'&&['full','reuse','unresolved'].includes(record.decision)){
    try{
      const original=originalEarlyVerifier(readApi)(observedEarlyOrigin.context,observedEarlyOrigin.run,observedEarlyOrigin.jobs,record.inputContext);
      original.inputKey=ciInputKey(record.inputContext,'early-startup');record.earlyCoverage=original;
      if(!canonicalCoverage){record.decision='full';record.coveredBy=null;delete record.producerKind;}
    }catch(error){record.decision='unresolved';record.producerKind='early-evidence-unavailable';record.reason=error.message;}
  }
  record.gateDecisions=Object.fromEntries(CI_GATES.map(gate=>[gate,{inputKey:record.inputKeys[gate],mode:record.inputPasses[gate]?'covered':record.decision==='policy-reuse'?'policy-covered':['pending','unresolved','fail','cancelled'].includes(record.decision)?record.decision:'execute',original:(record.inputPasses[gate]||(record.decision==='policy-reuse'?record.policyInputPasses?.[gate]:null))?.coveredBy||null}]));
  record.nextGate = ['pending','unresolved'].includes(record.decision) ? 'resume-bound-producer-observation' : ['fail','cancelled'].includes(record.decision) ? 'repair-bound-producer' : record.decision === 'full' ? 'execute-uncovered-gates' : 'verify-required-aggregate';
  if(record.decision==='unresolved'&&record.producerKind==='mixed-consumer')record.nextGate='verify-original-early-producer';
  if(record.decision==='unresolved'&&record.producerKind==='early-evidence-unavailable')record.nextGate='verify-original-early-producer';
  writeFileSync(path.join(directory, 'routing.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `decision=${record.decision}\nearly-decision=${record.earlyCoverage?'reuse':record.decision}\ncontext=${record.contextSha256}\nevent-policy=${validationContext.eventPolicy}\npolicy=${validationContext.eventPolicy}\ntree=${checkoutTree}\nworkflow-blob=${cohort?.workflowBlob||''}\ncohort=${cohort?.cohortDigestSha256||''}\ninput-keys=${JSON.stringify(record.inputKeys)}\nreused=${JSON.stringify(Object.keys(record.inputPasses))}\n`);
  console.log(`CI routing decision=${record.decision} reused-gates=${Object.keys(record.inputPasses).join(',')||'none'} context=${record.contextSha256} source=${sourceSha} actual-checkout=${checkoutSha} producer=${record.coveredBy ? `${record.coveredBy.runId}/${record.coveredBy.runAttempt}` : 'none'} reason=${record.reason}`);
  if (record.decision === 'fail' || record.decision === 'cancelled') process.exitCode = 1;
  if (record.decision === 'pending' || record.decision === 'unresolved') process.exitCode = 2;
}

main().catch(error => { console.error(`ci-routing: ${error.message}`); process.exitCode = 1; });
