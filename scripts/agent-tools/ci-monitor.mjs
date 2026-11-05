#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { GROUP_IDS } from '../test-groups.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

function parseArguments(args) {
  const options = {};
  const allowed = new Set(['repo', 'run-id', 'commit', 'evidence-dir', 'interval-ms', 'max-interval-ms', 'max-polls', 'max-wait-ms', 'max-retries', 'retry-delay-ms', 'max-retry-delay-ms', 'request-timeout-ms']);
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
    if (!allowed.has(name.slice(2))) throw new Error(`Unknown option: ${name}.`);
    options[name.slice(2)] = value;
    index += 1;
  }
  for (const name of ['repo', 'run-id', 'commit', 'evidence-dir']) {
    if (!options[name]) throw new Error(`Required option: --${name}.`);
  }
  if (!/^\d+$/.test(options['run-id'])) throw new Error('--run-id must be a decimal GitHub Actions run id.');
  if (!/^[a-f0-9]{40}$/i.test(options.commit)) throw new Error('--commit must be the full 40-character release commit SHA.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) throw new Error('--repo must be OWNER/REPOSITORY.');
  const numberOption = (name, fallback, minimum, maximum) => {
    const number = options[name] === undefined ? fallback : Number(options[name]);
    if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}.`);
    return number;
  };
  options.intervalMs = numberOption('interval-ms', 5000, 1, 60000);
  options.maxIntervalMs = numberOption('max-interval-ms', 30000, options.intervalMs, 60000);
  options.maxPolls = numberOption('max-polls', 20, 1, 100);
  options.maxWaitMs = numberOption('max-wait-ms', 90000, 1, 600000);
  options.maxRetries = numberOption('max-retries', 2, 0, 4);
  options.retryDelayMs = numberOption('retry-delay-ms', 500, 1, 10000);
  options.maxRetryDelayMs = numberOption('max-retry-delay-ms', 4000, options.retryDelayMs, 30000);
  options.requestTimeoutMs = numberOption('request-timeout-ms', 20000, 1, 30000);
  return options;
}

function childEnvironment(transport) {
  if (!transport.disableHttp2) return process.env;
  const godebug = String(process.env.GODEBUG ?? '').split(',').filter((setting) => setting && !/^http2client=/.test(setting));
  godebug.push('http2client=0');
  return { ...process.env, GODEBUG: [...new Set(godebug)].join(',') };
}

async function ghOutput(args, { options, transport, requestsPath, kind, maxBuffer, deadline }) {
  let retries = 0;
  let retryDelayMs = options.retryDelayMs;
  const attempts = [];
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      const error = new Error(`Interactive wait limit reached before the next ${kind} read.`);
      error.attempts = attempts;
      error.transportFallbackUsed = transport.fallbackUsed;
      throw error;
    }
    const usedFallback = transport.disableHttp2;
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      env: childEnvironment(transport),
      maxBuffer,
      timeout: Math.max(1, Math.min(options.requestTimeoutMs, remainingMs)),
    });
    const problem = result.error?.message
      || (result.status === 0 ? null : (result.stderr || result.stdout || `gh exited ${result.status}`).trim());
    const attempt = {
      kind,
      args,
      attempt: attempts.length + 1,
      exitCode: result.status,
      signal: result.signal,
      ...(problem ? { error: problem } : {}),
      http2Disabled: usedFallback,
      observedAt: new Date().toISOString(),
    };
    attempts.push(attempt);
    await appendFile(requestsPath, `${JSON.stringify(attempt)}\n`, { mode: 0o600 });
    if (!problem) return { stdout: result.stdout, attempts, transportFallbackUsed: transport.fallbackUsed };
    if (retries >= options.maxRetries) {
      const error = new Error(`Could not ${kind === 'run' ? 'observe CI run' : 'read full CI logs for run'}: ${problem}`);
      error.attempts = attempts;
      error.transportFallbackUsed = transport.fallbackUsed;
      throw error;
    }
    const remainingBeforeRetry = deadline - Date.now();
    if (remainingBeforeRetry <= 0) {
      const error = new Error(`Interactive wait limit reached while attempting to ${kind === 'run' ? 'observe CI run' : 'read full CI logs'}: ${problem}`);
      error.attempts = attempts;
      error.transportFallbackUsed = transport.fallbackUsed;
      throw error;
    }
    if (/TLS handshake timeout/i.test(problem) && !transport.disableHttp2) {
      transport.disableHttp2 = true;
      transport.fallbackUsed = true;
      retries += 1;
      continue;
    }
    await delay(Math.min(retryDelayMs, remainingBeforeRetry));
    retryDelayMs = Math.min(retryDelayMs * 2, options.maxRetryDelayMs);
    retries += 1;
  }
}

async function readRun({ repo, runId, options, transport, requestsPath, deadline }) {
  const result = await ghOutput([
    'run', 'view', runId, '--repo', repo,
    '--json', 'databaseId,headSha,status,conclusion,event,headBranch,workflowName,jobs,attempt',
  ], { options, transport, requestsPath, kind: 'run', maxBuffer: 10 * 1024 * 1024, deadline });
  try {
    return { run: JSON.parse(result.stdout), raw: result.stdout, transportFallbackUsed: result.transportFallbackUsed };
  } catch (error) {
    throw new Error(`Could not parse CI run ${runId} response: ${error.message}`);
  }
}

async function readLogs({ repo, runId, attempt, options, transport, requestsPath, deadline }) {
  const result = await ghOutput(['run', 'view', runId, '--repo', repo, ...(attempt ? ['--attempt',String(attempt)] : []), '--log'], {
    options,
    transport,
    requestsPath,
    kind: 'logs',
    maxBuffer: 100 * 1024 * 1024,
    deadline,
  });
  return { logs: result.stdout, transportFallbackUsed: result.transportFallbackUsed };
}

async function bindWorkflowPolicy(run, logs, state) {
  if(!Number.isInteger(run.attempt)||run.attempt<1)throw new Error('Missing exact run attempt identity.');
  const checkoutMatches=[...logs.matchAll(/git log -1 --format=%H[^\r\n]*[\r\n]+[^\r\n]*?\b([a-f0-9]{40})\b/g)].map(match=>match[1]);
  const announced=(run.jobs||[]).flatMap(job=>job.steps||[]).map(step=>step.name).filter(name=>/^Actual checkout [a-f0-9]{40} tree [a-f0-9]{40}$/.test(name));
  const candidates=[...new Set([...checkoutMatches,...announced.map(name=>name.split(' ')[2])])];
  if(candidates.length!==1)throw new Error('Actual checkout provenance is missing or ambiguous.');
  const checkoutSha=candidates[0];
  if(run.event==='push'&&checkoutSha!==run.headSha)throw new Error('Push actual checkout differs from source.');
  const api=async endpoint=>{
    const result=await ghOutput(['api',`repos/${state.options.repo}/${endpoint}`],{...state,kind:'policy',maxBuffer:10*1024*1024});
    await appendFile(join(state.attemptDirectory,'policy-reads.jsonl'),JSON.stringify({endpoint,response:result.stdout})+'\n',{mode:0o600});
    return JSON.parse(result.stdout);
  };
  const commit=await api('git/commits/'+checkoutSha);
  if(commit.sha!==checkoutSha||! /^[a-f0-9]{40}$/.test(commit.tree?.sha||''))throw new Error('Actual checkout commit/tree response is not bound.');
  if(run.event==='pull_request'&&(commit.parents?.length!==2||commit.parents[1].sha!==run.headSha))throw new Error('PR checkout parents do not bind the exact source.');
  if(announced.some(name=>name.split(' ')[4]!==commit.tree.sha))throw new Error('Announced actual checkout tree mismatch.');
  const response=await api('contents/.github/workflows/data-safety.yml?ref='+checkoutSha);
  if(response.encoding!=='base64'||typeof response.content!=='string')throw new Error('Missing actual candidate workflow bytes.');
  const bytes=Buffer.from(response.content.replace(/\s/g,''),'base64');
  const blob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
  if(response.sha!==blob)throw new Error('Actual candidate workflow blob digest mismatch.');
  const text=bytes.toString('utf8');
  const ids=[...text.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map(match=>match[1]).filter(id=>!['push','pull_request'].includes(id));
  const legacy=['scanner-tests','release-evidence','deploy-pages'];
  const parallel=['validation-context','event-gates','cohort-routing','regression',...legacy];
  let topology,required;
  if(/^  CHAIN_CI_TOPOLOGY: four-groups-v1$/m.test(text)) {
    if(JSON.stringify(ids)!==JSON.stringify(parallel)||!text.includes('name: regression-${{ matrix.group }}')||!text.includes('group: ['+GROUP_IDS.join(', ')+']')||!text.includes('needs: [scanner-tests, release-evidence]'))throw new Error('Unknown parallel workflow topology.');
    topology='four-groups-v1';required=['validation-context','event-gates','cohort-routing',...GROUP_IDS.map(id=>'regression-'+id),'scanner-tests'];
  } else if(JSON.stringify(ids)===JSON.stringify(legacy)&&!text.includes('CHAIN_CI_TOPOLOGY')) {topology='legacy-serial';required=['scanner-tests'];}
  else throw new Error('Unknown actual candidate workflow topology.');
  const binding={topology,checkoutSha,checkoutTree:commit.tree.sha,comparisonBase:run.event==='pull_request'?commit.parents[0].sha:null,workflowBlob:blob,runId:String(run.databaseId),runAttempt:run.attempt,required,known:[...required,'release-evidence','deploy-pages']};
  await writeFile(join(state.attemptDirectory,'workflow-policy.json'),JSON.stringify(binding,null,2)+'\n',{mode:0o600});
  return binding;
}

function expectedSkippedJobs(run) {
  const isMainPush = run.event === 'push' && run.headBranch === 'main';
  return isMainPush ? new Set() : new Set(['release-evidence', 'deploy-pages']);
}

function classifyRun(run, policy = null) {
  const status = String(run.status ?? '').toLowerCase();
  const conclusion = String(run.conclusion ?? '').toLowerCase();
  const expectedSkipped = expectedSkippedJobs(run);
  const jobs = Array.isArray(run.jobs) ? run.jobs : null;
  const jobSummary = jobs?.map((job) => {
    const name = String(job.name ?? 'unnamed-job');
    const state = String(job.conclusion ?? job.status ?? 'unknown').toLowerCase();
    return `${name}=${state === 'skipped' && expectedSkipped.has(name) ? 'expected-skipped' : state}`;
  }).join(',') ?? 'jobs=unavailable';
  const classification = (result, exitCode, reason = null) => ({ result, exitCode, jobSummary, reason });

  if (run.workflowName !== 'Data safety') return classification('unresolved', 2, `Unknown workflow policy: ${String(run.workflowName)}.`);
  if (!['push', 'pull_request'].includes(run.event)) return classification('unresolved', 2, `Unknown workflow event policy: ${String(run.event)}.`);
  if (!jobs) return classification('unresolved', 2, 'GitHub did not return the run jobs.');
  if (status === 'waiting') return classification('waiting', 2);
  if (['queued', 'pending', 'requested'].includes(status)) return classification('pending', 2);
  if (status === 'in_progress' || status === 'post_pending') return classification('running', 2);
  if (status !== 'completed') return classification('unresolved', 2, `Unknown run status: ${status || 'missing'}.`);
  if (conclusion === 'cancelled') return classification('canceled', 1);
  if (['failure', 'timed_out', 'action_required', 'stale', 'startup_failure'].includes(conclusion)) return classification('failure', 1);
  if (conclusion !== 'success') return classification('unresolved', 2, `Unknown run conclusion: ${conclusion || 'missing'}.`);

  if(!policy)return classification('unresolved',2,'Actual candidate workflow policy could not be verified.');
  const currentWorkflowJobs=new Set(policy.known);
  const byName = new Map();
  for (const job of jobs) {
    const name = String(job.name ?? '');
    if (!name || byName.has(name)) return classification('unresolved', 2, `Missing or duplicate job name: ${name || 'unnamed job'}.`);
    if (!currentWorkflowJobs.has(name)) return classification('unresolved', 2, `Unknown required-job policy for ${name}.`);
    byName.set(name, job);
  }
  const required = run.event === 'push' && run.headBranch === 'main'
    ? [...policy.required, 'release-evidence', 'deploy-pages']
    : policy.required;
  for (const name of required) {
    const job = byName.get(name);
    if (!job) return classification('failure', 1, `Required job ${name} is missing.`);
    const jobConclusion = String(job.conclusion ?? '').toLowerCase();
    if (jobConclusion === 'success') continue;
    if (jobConclusion === 'cancelled') return classification('canceled', 1, `Required job ${name} was canceled.`);
    if (jobConclusion === 'skipped') return classification('failure', 1, `Required job ${name} was skipped.`);
    if (jobConclusion === 'failure' || jobConclusion === 'timed_out' || jobConclusion === 'action_required') {
      return classification('failure', 1, `Required job ${name} concluded ${jobConclusion}.`);
    }
    return classification('unresolved', 2, `Required job ${name} has no terminal success.`);
  }
  for (const job of jobs) {
    const name = String(job.name);
    const jobConclusion = String(job.conclusion ?? '').toLowerCase();
    if (jobConclusion === 'success') continue;
    if (jobConclusion === 'skipped' && expectedSkipped.has(name)) continue;
    if (jobConclusion === 'cancelled') return classification('canceled', 1, `Job ${name} was canceled.`);
    if (jobConclusion === 'skipped') return classification('failure', 1, `Unexpected skipped job ${name}.`);
    if (['failure', 'timed_out', 'action_required', 'stale', 'startup_failure'].includes(jobConclusion)) {
      return classification('failure', 1, `Job ${name} concluded ${jobConclusion}.`);
    }
    return classification('unresolved', 2, `Job ${name} has no terminal success.`);
  }
  if(policy.topology==='four-groups-v1'){
    const early=(byName.get('validation-context').steps||[]).filter(step=>step.conclusion==='success').map(step=>step.name);
    const source=early.filter(name=>new RegExp(`^Validation source ${run.headSha} base [a-f0-9]{40}$`).test(name));
    const context=early.filter(name=>/^Announce regression context [a-f0-9]{64}$/.test(name));
    if(source.length!==1||context.length!==1||!early.includes(`Actual checkout ${policy.checkoutSha} tree ${policy.checkoutTree}`)||!early.includes(`Workflow blob ${policy.workflowBlob} policy four-groups-v1`))return classification('failure',1,'Required exact workflow/context announcement is missing or ambiguous.');
    const base=source[0].split(' ').at(-1),digest=context[0].split(' ').at(-1);
    if(policy.comparisonBase&&base!==policy.comparisonBase)return classification('failure',1,'Announced PR comparison base differs from actual merge parent.');
    const steps=(byName.get('scanner-tests').steps||[]).filter(step=>step.conclusion==='success').map(step=>step.name);
    const verified=steps.filter(name=>new RegExp(`^Verified complete cohort ${digest} report [a-f0-9]{64} mode (full|reuse)$`).test(name));
    if(!steps.includes('Verify complete required cohort')||verified.length!==1)return classification('failure',1,'Required verified aggregate attestation is missing or ambiguous.');
    const words=verified[0].split(' '),report=words[5],mode=words[7];
    if(mode==='full'&&steps.filter(name=>name===`Complete regression context ${digest} report ${report}`).length!==1)return classification('failure',1,'Required full producer completion attestation is missing.');
    policy.comparisonBase=base;policy.contextSha256=digest;policy.reportSha256=report;policy.mode=mode;
  }
  return classification('success', 0);
}

function snapshotKey(run, outcome) {
  return JSON.stringify({
    status: run.status,
    conclusion: run.conclusion,
    result: outcome.result,
    jobs: (run.jobs ?? []).map(({ name, status, conclusion }) => ({ name, status, conclusion })),
  });
}

function progressLine(run, outcome, options) {
  return `CI monitor progress=run=${options['run-id']} commit=${options.commit.slice(0, 12)} status=${run.status} jobs=${outcome.jobSummary}`;
}

function resultLine(outcome, run, options, evidencePath, reason = null) {
  return `CI monitor result=${outcome.result} run=${options['run-id']} commit=${options.commit}${run ? ` status=${run.status} jobs=${outcome.jobSummary}` : ''}${reason ? ` reason=${reason}` : ''} evidence=${evidencePath}`;
}

async function writeSummary(attemptDirectory, summary) {
  await writeFile(join(attemptDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const evidenceDirectory = resolve(options['evidence-dir']);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const attemptDirectory = join(evidenceDirectory, `run-${options['run-id']}-${options.commit.slice(0, 12)}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(attemptDirectory, { mode: 0o700 });
  const snapshotsPath = join(attemptDirectory, 'snapshots.jsonl');
  const progressPath = join(attemptDirectory, 'progress.jsonl');
  const requestsPath = join(attemptDirectory, 'requests.jsonl');
  const transport = { disableHttp2: false, fallbackUsed: false };
  const startedAt = Date.now();
  const deadline = startedAt + options.maxWaitMs;
  let previousKey = null;
  let pollDelayMs = 0;
  let pollsCompleted = 0;
  let lastRun = null;
  let lastOutcome = null;
  for (let poll = 1; poll <= options.maxPolls; poll += 1) {
    if (poll > 1) {
      const remainingMs = Math.max(0, deadline - Date.now());
      if (pollDelayMs >= remainingMs) break;
      await delay(pollDelayMs);
      if (Date.now() >= deadline) break;
    }
    let observation;
    try {
      observation = await readRun({ repo: options.repo, runId: options['run-id'], options, transport, requestsPath, deadline });
    } catch (error) {
      const reason = error.message;
      const unresolved = { result: 'unresolved', exitCode: 2, jobSummary: 'jobs=unavailable', reason };
      await writeSummary(attemptDirectory, {
        repo: options.repo,
        runId: options['run-id'],
        commit: options.commit,
        result: 'unresolved',
        polls: poll - 1,
        status: 'unavailable',
        requests: requestsPath,
        snapshots: snapshotsPath,
        progress: progressPath,
        transportFallbackUsed: transport.fallbackUsed,
        reason,
      });
      process.stdout.write(`${resultLine(unresolved, null, options, attemptDirectory, reason)}\n`);
      process.exitCode = 2;
      return;
    }
    const { run, raw } = observation;
    pollsCompleted = poll;
    await appendFile(snapshotsPath, raw.endsWith('\n') ? raw : `${raw}\n`, { mode: 0o600 });
    if (String(run.databaseId) !== options['run-id']) {
      const reason = `Run identity mismatch: requested ${options['run-id']}, received ${String(run.databaseId)}.`;
      await writeSummary(attemptDirectory, { runId: options['run-id'], commit: options.commit, result: 'identity-mismatch', polls: poll, reason, snapshots: snapshotsPath, progress: progressPath });
      process.stderr.write(`ci-monitor: ${reason} evidence=${attemptDirectory}\n`);
      process.exitCode = 1;
      return;
    }
    if (String(run.headSha).toLowerCase() !== options.commit.toLowerCase()) {
      const reason = `Commit identity mismatch: requested ${options.commit}, received ${String(run.headSha)}.`;
      await writeSummary(attemptDirectory, { runId: options['run-id'], commit: options.commit, result: 'identity-mismatch', polls: poll, reason, snapshots: snapshotsPath, progress: progressPath });
      process.stderr.write(`ci-monitor: ${reason} evidence=${attemptDirectory}\n`);
      process.exitCode = 1;
      return;
    }
    let cachedLogs=null,policy=null,policyError=null,logsReadError=null;
    if(run.status==='completed'&&run.conclusion==='success'&&run.workflowName==='Data safety'&&['push','pull_request'].includes(run.event)) {
      try {
        try{cachedLogs=(await readLogs({repo:options.repo,runId:options['run-id'],attempt:run.attempt,options,transport,requestsPath,deadline})).logs;}catch(error){logsReadError=error.message;throw error;}
        policy=await bindWorkflowPolicy(run,cachedLogs,{options,transport,requestsPath,deadline,attemptDirectory});
      } catch(error){policyError=error.message;}
    }
    let outcome = classifyRun(run,policy);
    if(policyError&&outcome.result==='unresolved')outcome={...outcome,reason:policyError};
    const key = snapshotKey(run, outcome);
    const changed = key !== previousKey;
    const nonterminal = ['pending', 'waiting', 'running'].includes(outcome.result);
    const hasPollBudget = poll < options.maxPolls && Date.now() < deadline;
    const nextDelayMs = nonterminal && hasPollBudget
      ? (changed ? options.intervalMs : Math.min(Math.max(options.intervalMs, pollDelayMs * 2), options.maxIntervalMs))
      : 0;
    const willPollAgain = nonterminal && hasPollBudget && nextDelayMs < deadline - Date.now();
    await appendFile(progressPath, `${JSON.stringify({
      poll,
      observedAt: new Date().toISOString(),
      changed,
      status: run.status,
      conclusion: run.conclusion,
      result: outcome.result,
      jobSummary: outcome.jobSummary,
      nextDelayMs: willPollAgain ? nextDelayMs : 0,
      yielded: nonterminal && !willPollAgain,
    })}\n`, { mode: 0o600 });
    if (changed) process.stdout.write(`${progressLine(run, outcome, options)}\n`);
    previousKey = key;
    lastRun = run;
    lastOutcome = outcome;
    if (!['pending', 'waiting', 'running'].includes(outcome.result)) {
      let logsState = 'saved';
      let logsError = null;
      try {
        if(logsReadError)throw new Error(logsReadError);
        const logs=cachedLogs ?? (await readLogs({ repo: options.repo, runId: options['run-id'], attempt:run.attempt, options, transport, requestsPath, deadline })).logs;
        await writeFile(join(attemptDirectory, 'logs.txt'), logs, { mode: 0o600 });
      } catch (error) {
        logsState = 'unavailable';
        logsError = error.message;
      }
      const finalOutcome = outcome.result === 'success' && logsState !== 'saved'
        ? { ...outcome, result: 'unresolved', exitCode: 2, reason: 'Full raw logs could not be persisted.' }
        : outcome;
      if(policy)await writeFile(join(attemptDirectory,'workflow-policy.json'),JSON.stringify(policy,null,2)+'\n',{mode:0o600});
      await writeSummary(attemptDirectory, {
        repo: options.repo,
        runId: options['run-id'],
        commit: options.commit,
        result: finalOutcome.result,
        polls: poll,
        status: run.status,
        conclusion: run.conclusion,
        runAttempt: run.attempt,
        workflowPolicy: policy,
        logsState,
        requests: requestsPath,
        progress: progressPath,
        transportFallbackUsed: transport.fallbackUsed,
        ...(logsError ? { logsError } : {}),
        snapshots: snapshotsPath,
        logs: logsState === 'saved' ? join(attemptDirectory, 'logs.txt') : null,
        ...(finalOutcome.reason ? { reason: finalOutcome.reason } : {}),
      });
      process.stdout.write(`${resultLine(finalOutcome, run, options, attemptDirectory, finalOutcome.reason ?? logsError)}\n`);
      process.exitCode = finalOutcome.exitCode;
      return;
    }
    if (!willPollAgain) break;
    pollDelayMs = nextDelayMs;
  }
  const yielded = lastOutcome ?? { result: 'unavailable', exitCode: 2, jobSummary: 'jobs=unavailable' };
  let logsState = 'unavailable';
  let logsError = null;
  if (lastRun) {
    try {
      const { logs } = await readLogs({ repo: options.repo, runId: options['run-id'], attempt:lastRun.attempt, options, transport, requestsPath, deadline });
      await writeFile(join(attemptDirectory, 'logs.txt'), logs, { mode: 0o600 });
      logsState = 'saved';
    } catch (error) {
      logsError = error.message;
    }
  }
  const reason = `yielded after ${pollsCompleted} polls; limits ${options.maxPolls} polls and ${options.maxWaitMs}ms`;
  await writeSummary(attemptDirectory, {
    repo: options.repo,
    runId: options['run-id'],
    commit: options.commit,
    result: yielded.result,
    polls: pollsCompleted,
    ...(lastRun ? { status: lastRun.status, conclusion: lastRun.conclusion } : {}),
    logsState,
    requests: requestsPath,
    progress: progressPath,
    transportFallbackUsed: transport.fallbackUsed,
    ...(logsError ? { logsError } : {}),
    snapshots: snapshotsPath,
    logs: logsState === 'saved' ? join(attemptDirectory, 'logs.txt') : null,
    reason,
  });
  process.stdout.write(`${resultLine(yielded, lastRun, options, attemptDirectory, logsError ?? reason)}\n`);
  process.exitCode = 2;
}

// Weekly velocity report (#2217). Merges fell from 60 a week to none for a week
// before anyone noticed (#2205), while every CI run stayed green. The nightly
// workflow runs this over a rolling 7-day window so a stall or an issue
// explosion is visible within a week rather than after a month.
const VELOCITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function parseVelocityArguments(args) {
  const options = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--dry-run') { options.dryRun = true; continue; }
    if (!['--repo', '--now'].includes(name)) throw new Error(`Unknown velocity-report option: ${name}.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
    options[name.slice(2)] = value;
    index += 1;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo ?? '')) throw new Error('--repo must be OWNER/REPOSITORY.');
  options.now = options.now === undefined ? new Date() : new Date(options.now);
  if (Number.isNaN(options.now.getTime())) throw new Error('--now must be an ISO 8601 timestamp.');
  return options;
}

function ghJson(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(result.error?.message || result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  return JSON.parse(result.stdout);
}

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;
// Nearest-rank percentile: always an observed run duration, never interpolated.
const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function readVelocity(options) {
  const end = options.now, start = new Date(end.getTime() - VELOCITY_WINDOW_MS), since = isoSeconds(start);
  const inWindow = (stamp) => { const time = Date.parse(stamp); return time >= start.getTime() && time <= end.getTime(); };
  // GitHub search filters are only a pre-filter; the exact window is applied here.
  const merged = ghJson(['pr', 'list', '--repo', options.repo, '--state', 'merged', '--base', 'main', '--search', `merged:>=${since}`, '--limit', '500', '--json', 'number,title,mergedAt'])
    .filter((pr) => inWindow(pr.mergedAt)).sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
  const open = ghJson(['pr', 'list', '--repo', options.repo, '--state', 'open', '--limit', '500', '--json', 'number,title,createdAt,isDraft,baseRefName'])
    .map((pr) => ({ ...pr, ageDays: Math.floor((end.getTime() - Date.parse(pr.createdAt)) / 86400000) }))
    .sort((a, b) => b.ageDays - a.ageDays);
  // Only runs that ran to a verdict measure CI cost; cancelled (superseded) and
  // unfinished runs would understate it.
  const durations = ghJson(['run', 'list', '--repo', options.repo, '--workflow', 'data-safety.yml', '--created', `>=${since}`, '--limit', '1000', '--json', 'databaseId,startedAt,updatedAt,status,conclusion'])
    .filter((run) => run.status === 'completed' && ['success', 'failure'].includes(run.conclusion) && inWindow(run.startedAt))
    .map((run) => Date.parse(run.updatedAt) - Date.parse(run.startedAt)).sort((a, b) => a - b);
  const issueSearch = ghJson(['api', '-X', 'GET', 'search/issues', '-f', `q=repo:${options.repo} is:issue created:>=${since}`, '-f', 'per_page=1']);
  return { start, end, merged, open, durations, issuesOpened: issueSearch.total_count };
}

function velocitySummary(report) {
  const { start, end, merged, open, durations, issuesOpened } = report;
  // Every list line starts with "- " so a PR title can never begin a line with
  // "::" and be read as a workflow command when this is printed to the run log.
  return [
    '## Weekly velocity report',
    '',
    `Window: ${isoSeconds(start)} to ${isoSeconds(end)}`,
    '',
    '| Measure | Value |',
    '| --- | --- |',
    `| Merged PRs to main | ${merged.length} |`,
    `| Median CI duration | ${durations.length ? minutes(percentile(durations, 0.5)) : 'n/a'} (${plural(durations.length, 'finished Data safety run')}) |`,
    `| p90 CI duration | ${durations.length ? minutes(percentile(durations, 0.9)) : 'n/a'} |`,
    `| Issues opened | ${issuesOpened} |`,
    `| Open PRs | ${open.length} |`,
    '',
    '### Merged PRs',
    ...(merged.length ? merged.map((pr) => `- #${pr.number} ${pr.title} (${pr.mergedAt.slice(0, 10)})`) : [`- None since ${isoSeconds(start)}`]),
    '',
    '### Open PR ages',
    ...(open.length ? open.map((pr) => `- #${pr.number} ${pr.title}: ${plural(pr.ageDays, 'day')}${pr.isDraft ? ' (draft)' : ''}${pr.baseRefName && pr.baseRefName !== 'main' ? ` (into ${pr.baseRefName})` : ''}`) : ['- None']),
    '',
  ].join('\n');
}

async function velocityReport(args) {
  const options = parseVelocityArguments(args);
  const report = readVelocity(options);
  const summary = velocitySummary(report);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  const alerts = velocityAlerts(report);
  if (!alerts.length) return;
  for (const alert of alerts) process.stdout.write(`::error title=${alert.title}::${alert.message}\n`);
  const body = [...alerts.map((alert) => `- **${alert.title}**: ${alert.message}`), '', summary].join('\n');
  // One open alert issue at a time: the nightly run comments on it while the
  // alert persists instead of adding to the issue pile it is meant to warn about.
  // Title search is fuzzy, so only an exact title match counts.
  const existing = ghJson(['issue', 'list', '--repo', options.repo, '--state', 'open', '--label', 'needs-triage', '--search', `"${VELOCITY_ALERT_TITLE}" in:title`, '--limit', '100', '--json', 'number,title'])
    .filter((issue) => issue.title === VELOCITY_ALERT_TITLE).sort((a, b) => a.number - b.number)[0];
  // A dry run reads the real repository but never writes, for local checks.
  if (options.dryRun) process.stdout.write(`Velocity dry run: would ${existing ? `comment on #${existing.number}` : `create "${VELOCITY_ALERT_TITLE}" labelled needs-triage`}.\n`);
  else if (existing) ghText(['issue', 'comment', String(existing.number), '--repo', options.repo, '--body', body]);
  else ghText(['issue', 'create', '--repo', options.repo, '--title', VELOCITY_ALERT_TITLE, '--label', 'needs-triage', '--body', body]);
  // The alert is a visible failure of the nightly job, not just a log line.
  process.exitCode = 1;
}

const VELOCITY_ALERT_TITLE = 'Weekly velocity alert';

// The atomic-issue rule produced 1,594 issues in its first week (#2205); planning
// had replaced shipping. More than 100 in a week is the agreed early warning.
const VELOCITY_ISSUE_LIMIT = 100;

function velocityAlerts({ merged, open, issuesOpened }) {
  const alerts = [];
  if (!merged.length && open.length) alerts.push({ title: 'Velocity stall', message: `No PR merged to main in 7 days while ${plural(open.length, 'open PR')} wait.` });
  if (issuesOpened > VELOCITY_ISSUE_LIMIT) alerts.push({ title: 'Issue spike', message: `${issuesOpened} issues opened in 7 days (limit ${VELOCITY_ISSUE_LIMIT}).` });
  return alerts;
}

function ghText(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(result.error?.message || result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  return result.stdout.trim();
}

(process.argv[2] === 'velocity-report' ? velocityReport(process.argv.slice(3)) : main()).catch((error) => {
  process.stderr.write(`ci-monitor: ${error.message}\n`);
  process.exitCode = 1;
});
