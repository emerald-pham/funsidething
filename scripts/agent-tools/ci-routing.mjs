#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const decimal = value => /^[1-9][0-9]*$/.test(String(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const workflowPath = '.github/workflows/data-safety.yml';

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!['comparison-base', 'evidence-dir', 'max-wait-ms', 'poll-interval-ms', 'descriptor', 'plan-only'].includes(key) || !value || result[key]) throw new Error('Pass --comparison-base SHA --evidence-dir NEW_DIRECTORY.');
    result[key] = value;
  }
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
  let mobileProducer = false;
  if (args.descriptor) {
    const descriptor = JSON.parse(readFileSync(args.descriptor,'utf8')), identity=descriptor.resultIdentity;
    for (const [key,value] of Object.entries({repository,sourceSha,sourceTree,checkoutSha,checkoutTree,comparisonBase:args['comparison-base'],runId:process.env.GITHUB_RUN_ID})) {
      if (identity?.[key] !== value) throw new Error(`Descriptor identity mismatch: ${key}.`);
    }
    if (String(identity.runAttempt)!==process.env.GITHUB_RUN_ATTEMPT || identity.checkoutDirty || !/^[a-f0-9]{64}$/.test(identity.cohortDigestSha256) || JSON.stringify(identity.expectedGroups)!==JSON.stringify(['core','scenery','persistence-recovery','native-process'])) throw new Error('Invalid complete cohort descriptor.');
    const workflow=git('show',`${checkoutSha}:${workflowPath}`);
    if(/^  mobile-memory:\s*$/m.test(workflow)){
      const jobs=[...workflow.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map(match=>match[1]).filter(id=>!['push','pull_request'].includes(id));
      const job=id=>workflow.split(new RegExp('^  '+id+':\\s*$','m'))[1]?.split(/^  [a-z][a-z0-9-]*:\s*$/m)[0]||'';
      if(JSON.stringify(jobs)!==JSON.stringify(['validation-context','event-gates','cohort-routing','regression','mobile-memory','scanner-tests','release-evidence','deploy-pages'])||!/^    name: mobile-WebKit-512MB$/m.test(job('mobile-memory'))||!/^    needs: \[validation-context, event-gates, cohort-routing, regression, mobile-memory\]$/m.test(job('scanner-tests')))throw new Error('Unknown required mobile producer topology.');
      mobileProducer=true;
    }
    cohort={requiredCohort:'four-groups-v1',cohortDigestSha256:identity.cohortDigestSha256,inventorySha256:identity.inventorySha256,assignmentsSha256:identity.assignmentsSha256,expectedGroups:identity.expectedGroups,workflowBlob:git('rev-parse',`${checkoutSha}:${workflowPath}`)};
  }
  const boundContext = (...values) => ({...context(...values),...(cohort||{})});
  const validationContext = boundContext(repository, sourceSha, sourceTree, checkoutSha, checkoutTree, args['comparison-base'],
    eventName === 'pull_request' ? 'canonical-pr-merge-v1' : isMain ? 'exact-main-push-v1' : 'outgoing-branch-push-v1');
  const record = { schemaVersion: 1, eventName, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    validationContext, cohortContext: validationContext, contextSha256: hash(validationContext), decision: 'full',
    reason: isMain ? 'Exact main always executes its own complete cohort.' : 'No verified equivalent producer.', coveredBy: null, observations: [] };
  let apiReads = 0;
  function readApi(suffix) {
    if (++apiReads > 40) throw new Error('Public observation request budget exhausted.');
    const url = `https://api.github.com/repos/${repository}/${suffix}`;
    const response = spawnSync('curl', ['--disable', '--fail', '--silent', '--show-error', '--max-time', '10', '--connect-timeout', '5',
      '--header', 'Accept: application/vnd.github+json', '--header', 'User-Agent: chain-scanner-ci-routing', url],
    { encoding: 'utf8', timeout: 11000, maxBuffer: 8 * 1024 * 1024 });
    const evidence = `observation-${apiReads}.json`;
    writeFileSync(path.join(directory, evidence), response.stdout || response.stderr || response.error?.message || '', { mode: 0o600 });
    record.observations.push({ url, evidence, exitCode: response.status, observedAt: new Date().toISOString() });
    if (response.status !== 0 || response.error) throw new Error('Public GitHub observation unavailable.');
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
  const metadataEdit = eventName === 'pull_request' && event.action === 'edited' && !event.changes?.base;
  if (!args['plan-only'] && ((eventName === 'push' && !isMain) || metadataEdit)) {
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
      let pending = false;
      for (const run of runs) {
        if (['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status)) { pending = true; continue; }
        if (run.status !== 'completed') throw new Error('Unknown producer lifecycle.');
        const result = readApi(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        if (!Array.isArray(result.jobs) || result.total_count !== result.jobs.length) throw new Error('Producer jobs are incomplete.');
        const scanners = result.jobs.filter(job => job.name === 'scanner-tests');
        const scanner = scanners.length === 1 ? scanners[0] : null, steps = Array.isArray(scanner?.steps) ? scanner.steps : [];
        const earlyJobs=cohort ? result.jobs.filter(job=>job.name==='validation-context') : scanners;
        if(earlyJobs.length!==1)throw new Error('Producer announcement is missing or ambiguous.');
        const announcements=(earlyJobs[0].steps||[]).filter(step=>step.name===`Announce regression context ${expected}`&&step.conclusion==='success');
        if(announcements.length!==1)continue;
        for(const job of earlyJobs)if(String(job.run_id)!==String(run.id)||String(job.run_attempt)!==String(run.run_attempt)||job.head_sha!==sourceSha)throw new Error('Producer announcement attempt identity changed.');
        if(cohort&&run.conclusion!=='success') {
          record.decision='fail';record.reason=`Exact producer ${run.id}/${run.run_attempt} concluded ${run.conclusion}.`;break;
        }
        if(!scanner)throw new Error('Producer aggregate is missing or ambiguous.');
        if (String(scanner.run_id) !== String(run.id) || String(scanner.run_attempt) !== String(run.run_attempt) || scanner.head_sha !== sourceSha) throw new Error('Producer attempt identity changed.');
        if (run.conclusion !== 'success' || scanner.conclusion !== 'success' || scanner.status !== 'completed') {
          record.decision = 'fail'; record.reason = `Exact producer ${run.id}/${run.run_attempt} concluded ${run.conclusion}.`; break;
        }
        if(cohort){
          const required=['validation-context','event-gates','cohort-routing',...cohort.expectedGroups.map(id=>'regression-'+id),...(mobileProducer?['mobile-WebKit-512MB']:[]),'scanner-tests'];
          for(const name of required){
            const matches=result.jobs.filter(job=>job.name===name);
            if(matches.length!==1)throw new Error('Producer required topology is incomplete or ambiguous.');
            const job=matches[0];
            if(job.status!=='completed'||job.conclusion!=='success'||String(job.run_id)!==String(run.id)||String(job.run_attempt)!==String(run.run_attempt)||job.head_sha!==sourceSha)throw new Error('Producer required topology is incomplete.');
          }
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
        break;
      }
      if (record.decision !== 'full' || !pending || Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(args.pollIntervalMs, Math.max(0, deadline - Date.now()))));
      }
    } catch (error) {
      record.decision = 'full'; record.reason = `${error.message} Executing the actual checkout's complete cohort.`;
    }
  }
  writeFileSync(path.join(directory, 'routing.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `decision=${record.decision}\ncontext=${record.contextSha256}\nevent-policy=${validationContext.eventPolicy}\npolicy=${validationContext.eventPolicy}\ntree=${checkoutTree}\nworkflow-blob=${cohort?.workflowBlob||''}\ncohort=${cohort?.cohortDigestSha256||''}\n`);
  console.log(`CI routing decision=${record.decision} context=${record.contextSha256} source=${sourceSha} actual-checkout=${checkoutSha} producer=${record.coveredBy ? `${record.coveredBy.runId}/${record.coveredBy.runAttempt}` : 'none'} reason=${record.reason}`);
  if (record.decision === 'fail') process.exitCode = 1;
}

main().catch(error => { console.error(`ci-routing: ${error.message}`); process.exitCode = 1; });
