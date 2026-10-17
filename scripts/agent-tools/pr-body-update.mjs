#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';

const requestTimeoutMs = 30_000;
const maxOutputBytes = 10 * 1024 * 1024;
const usage = 'Usage: node scripts/agent-tools/pr-body-update.mjs --pr <owner/repository#number> --body-file <UTF-8-file>';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') return { help: true };
    if (name !== '--pr' && name !== '--body-file') throw new Error(`Unknown option: ${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`Option ${name} may be provided only once.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
    options[name] = value;
    index += 1;
  }
  if (!options['--pr']) throw new Error('Required option: --pr <owner/repository#number>.');
  if (!options['--body-file']) throw new Error('Required option: --body-file <UTF-8-file>.');
  return { help: false, options };
}

function parsePullRequest(value) {
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(value);
  if (!match) throw new Error(`Invalid PR identifier ${JSON.stringify(value)}; expected owner/repository#number.`);
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) throw new Error('PR number must be a positive safe integer.');
  return {
    identifier: `${match[1]}/${match[2]}#${number}`,
    repository: `${match[1]}/${match[2]}`,
    number,
    endpoint: `repos/${match[1]}/${match[2]}/pulls/${number}`,
  };
}

async function readBodyFile(filePath) {
  const bytes = await readFile(resolve(filePath));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Body file is not valid UTF-8: ${filePath}.`, { cause: error });
  }
}

function environmentWithoutHttp2(environment) {
  const next = { ...environment };
  const retained = (next.GODEBUG ?? '').split(',').filter((entry) => entry && !/^http2client=/i.test(entry));
  next.GODEBUG = [...retained, 'http2client=0'].join(',');
  return next;
}

function runGhApi(endpoint, { method = 'GET', input, disableHttp2 = false } = {}) {
  return new Promise((resolveResult) => {
    const args = ['api', endpoint];
    if (method !== 'GET') args.push('--method', method, '--input', '-');
    const child = spawn('gh', args, {
      shell: false,
      env: disableHttp2 ? environmentWithoutHttp2(process.env) : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let timeout = false;
    let oversized = false;
    let stdinFailure;
    const timer = setTimeout(() => {
      timeout = true;
      child.kill('SIGTERM');
    }, requestTimeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > maxOutputBytes) {
        oversized = true;
        child.kill('SIGTERM');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize <= 256 * 1024) stderr.push(chunk);
    });
    child.stdin.on('error', (error) => { stdinFailure = error; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveResult({ status: 127, stdout: '', stderr: error.message, spawnError: error });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolveResult({
        status: status ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timeout,
        oversized,
        stdinFailure,
      });
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input, 'utf8');
  });
}

function parsePullResponse(response, target) {
  let pull;
  try {
    pull = JSON.parse(response.stdout);
  } catch (error) {
    throw new Error('GitHub API returned an unreadable Pull Request response.', { cause: error });
  }
  const baseRepository = pull?.base?.repo?.full_name;
  if (pull?.number !== target.number || typeof baseRepository !== 'string' || baseRepository.toLowerCase() !== target.repository.toLowerCase()) {
    throw new Error(`GitHub API response did not identify ${target.identifier}.`);
  }
  return pull;
}

function assertGhSucceeded(response, action) {
  if (response.status === 0) return;
  if (response.timeout) throw new Error(`gh api ${action} timed out after ${requestTimeoutMs}ms.`);
  if (response.oversized) throw new Error(`gh api ${action} returned more than ${maxOutputBytes} bytes.`);
  const detail = response.stderr.trim() || `exit status ${response.status}${response.signal ? ` (${response.signal})` : ''}`;
  throw new Error(`gh api ${action} failed: ${detail}`);
}

function isDefiniteRejection(response) {
  if (response.spawnError) return true;
  const status = /\bHTTP\s+(\d{3})\b/i.exec(response.stderr)?.[1];
  if (!status) return false;
  const code = Number(status);
  return code >= 400 && code < 500 && code !== 408 && code !== 429;
}

function shouldDisableHttp2(response) {
  if (response.timeout || response.stdinFailure) return true;
  return /(unexpected eof|\beof\b|connection reset|connection refused|broken pipe|timed out|timeout|tls handshake|transport is closing|http\/?2|stream error|server closed)/i.test(response.stderr);
}

function summarizeFailure(response, action) {
  if (response.timeout) return `gh api ${action} timed out after ${requestTimeoutMs}ms.`;
  if (response.oversized) return `gh api ${action} returned more than ${maxOutputBytes} bytes.`;
  const detail = response.stderr.trim() || `exit status ${response.status}${response.signal ? ` (${response.signal})` : ''}`;
  return `gh api ${action} failed: ${detail}`;
}

function writeProblem(response, target, action) {
  return response.status === 0
    ? `GitHub returned an unreadable or mismatched Pull Request response for ${target.identifier}.`
    : summarizeFailure(response, action);
}

function successfulWrite(response, target, body) {
  if (response.status !== 0) return false;
  try {
    return parsePullResponse(response, target).body === body;
  } catch {
    return false;
  }
}

async function readBackBody(target, body, { disableHttp2 = false } = {}) {
  const response = await runGhApi(target.endpoint, { disableHttp2 });
  assertGhSucceeded(response, 'readback');
  const pull = parsePullResponse(response, target);
  return pull.body === body;
}

async function updatePullBody(target, body) {
  const payload = JSON.stringify({ body });
  const first = await runGhApi(target.endpoint, { method: 'PATCH', input: payload });
  if (successfulWrite(first, target, body)) return { verifiedAfterUncertainWrite: false };
  if (isDefiniteRejection(first)) throw new Error(summarizeFailure(first, 'PATCH'));

  const firstFailure = writeProblem(first, target, 'PATCH');
  const disableHttp2 = shouldDisableHttp2(first);
  let alreadyWritten;
  try {
    alreadyWritten = await readBackBody(target, body, { disableHttp2 });
  } catch (error) {
    throw new Error(`${firstFailure} Readback failed, so no retry was sent: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (alreadyWritten) return { verifiedAfterUncertainWrite: true };

  const retry = await runGhApi(target.endpoint, { method: 'PATCH', input: payload, disableHttp2 });
  if (successfulWrite(retry, target, body)) return { verifiedAfterUncertainWrite: false, retried: true };
  if (isDefiniteRejection(retry)) throw new Error(writeProblem(retry, target, 'PATCH retry'));

  try {
    if (await readBackBody(target, body, { disableHttp2: disableHttp2 || shouldDisableHttp2(retry) })) {
      return { verifiedAfterUncertainWrite: true, retried: true };
    }
  } catch (error) {
    throw new Error(`${writeProblem(retry, target, 'PATCH retry')} Final readback failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  throw new Error(`${writeProblem(retry, target, 'PATCH retry')} Readback confirmed that the requested body is not present; stopping after two writes.`);
}

export async function run(argv = process.argv.slice(2)) {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const target = parsePullRequest(parsed.options['--pr']);
  const body = await readBodyFile(parsed.options['--body-file']);
  const outcome = await updatePullBody(target, body);
  if (outcome.verifiedAfterUncertainWrite && outcome.retried) {
    process.stdout.write(`Verified ${target.identifier} body after retrying an uncertain update.\n`);
  } else if (outcome.verifiedAfterUncertainWrite) {
    process.stdout.write(`Verified ${target.identifier} body after an uncertain update; readback showed no retry was needed.\n`);
  } else {
    process.stdout.write(`Updated ${target.identifier} body.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    process.stderr.write(`PR body update failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
