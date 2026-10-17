#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
    '--json', 'databaseId,headSha,status,conclusion,event,headBranch,workflowName,jobs',
  ], { options, transport, requestsPath, kind: 'run', maxBuffer: 10 * 1024 * 1024, deadline });
  try {
    return { run: JSON.parse(result.stdout), raw: result.stdout, transportFallbackUsed: result.transportFallbackUsed };
  } catch (error) {
    throw new Error(`Could not parse CI run ${runId} response: ${error.message}`);
  }
}

async function readLogs({ repo, runId, options, transport, requestsPath, deadline }) {
  const result = await ghOutput(['run', 'view', runId, '--repo', repo, '--log'], {
    options,
    transport,
    requestsPath,
    kind: 'logs',
    maxBuffer: 100 * 1024 * 1024,
    deadline,
  });
  return { logs: result.stdout, transportFallbackUsed: result.transportFallbackUsed };
}

const currentWorkflowJobs = new Set(['scanner-tests', 'release-evidence', 'deploy-pages']);

function expectedSkippedJobs(run) {
  const isMainPush = run.event === 'push' && run.headBranch === 'main';
  return isMainPush ? new Set() : new Set(['release-evidence', 'deploy-pages']);
}

function classifyRun(run) {
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

  const byName = new Map();
  for (const job of jobs) {
    const name = String(job.name ?? '');
    if (!name || byName.has(name)) return classification('unresolved', 2, `Missing or duplicate job name: ${name || 'unnamed job'}.`);
    if (!currentWorkflowJobs.has(name)) return classification('unresolved', 2, `Unknown required-job policy for ${name}.`);
    byName.set(name, job);
  }
  const required = run.event === 'push' && run.headBranch === 'main'
    ? ['scanner-tests', 'release-evidence', 'deploy-pages']
    : ['scanner-tests'];
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
    const outcome = classifyRun(run);
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
        const { logs } = await readLogs({ repo: options.repo, runId: options['run-id'], options, transport, requestsPath, deadline });
        await writeFile(join(attemptDirectory, 'logs.txt'), logs, { mode: 0o600 });
      } catch (error) {
        logsState = 'unavailable';
        logsError = error.message;
      }
      const finalOutcome = outcome.result === 'success' && logsState !== 'saved'
        ? { ...outcome, result: 'unresolved', exitCode: 2, reason: 'Full raw logs could not be persisted.' }
        : outcome;
      await writeSummary(attemptDirectory, {
        repo: options.repo,
        runId: options['run-id'],
        commit: options.commit,
        result: finalOutcome.result,
        polls: poll,
        status: run.status,
        conclusion: run.conclusion,
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
      const { logs } = await readLogs({ repo: options.repo, runId: options['run-id'], options, transport, requestsPath, deadline });
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

main().catch((error) => {
  process.stderr.write(`ci-monitor: ${error.message}\n`);
  process.exitCode = 1;
});
