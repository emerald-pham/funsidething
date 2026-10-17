#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const purposes = new Set(['preimplementation-red', 'later-baseline-sensitivity', 'green']);
const cleanupGraceMs = 750;
const provenanceLimits = [
  'Generated metadata is not tamper-proof attestation.',
  'The declared purpose does not prove when a test was authored.',
  'The recorder does not automatically judge whether a RED is meaningful.',
];

function parseArguments(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0) throw new Error('Expected -- before the child command.');
  const options = {};
  for (let index = 0; index < separator; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--')) throw new Error(`Unexpected option: ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
    const key = name.slice(2);
    if (!['repo', 'evidence-dir', 'purpose', 'redact-pattern', 'correction-of', 'correction-note'].includes(key)) throw new Error(`Unknown option: ${name}`);
    if (key === 'redact-pattern') options[key] = [...(options[key] ?? []), value];
    else options[key] = value;
    index += 1;
  }
  const command = argv[separator + 1];
  if (!command) throw new Error('Expected a child command after --.');
  if (!options.repo) throw new Error('Required option: --repo <worktree>.');
  if (!options['evidence-dir']) throw new Error('Required option: --evidence-dir <directory>.');
  if (!purposes.has(options.purpose)) throw new Error(`Required --purpose must be one of: ${[...purposes].join(', ')}.`);
  return { options, command, commandArgs: argv.slice(separator + 2) };
}

function sanitizeText(input, redaction, location = 'metadata') {
  let value = String(input);
  const replace = (pattern, replacement) => {
    value = value.replace(pattern, (...args) => {
      redaction.count += 1;
      redaction.locations[location] = (redaction.locations[location] ?? 0) + 1;
      return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
  };
  // Match JSON keys before the ordinary key/value forms, including JSON nested in code strings.
  const quotedKey = /(?:\\*["'])((?:github[_-]?token|aws[_-]?secret[_-]?access[_-]?key|password|passwd|secret|token|api[_-]?(?:key|token)|authorization|cookie|access[_-]?(?:token|key)|client[_-]?secret|private[_-]?key))(?:\\*["'])\s*:\s*/gi;
  const original = value;
  let cursor = 0;
  let sanitized = '';
  for (const match of original.matchAll(quotedKey)) {
    if (match.index < cursor) continue;
    const start = match.index + match[0].length;
    const opening = original.slice(start).match(/^(\\*)(["'])/);
    let end = start;
    if (opening) {
      const quote = opening[2];
      for (let index = start + opening[0].length; index < original.length; index += 1) {
        if (original[index] !== quote) continue;
        let slashCount = 0;
        for (let back = index - 1; back >= start && original[back] === '\\'; back -= 1) slashCount += 1;
        if (slashCount === opening[1].length) { end = index + 1; break; }
      }
      // An unterminated credential remains sensitive through the end of its field.
      if (end === start) end = original.length;
    } else {
      end = start + (original.slice(start).match(/^[^\s,;}]+/)?.[0].length ?? 0);
    }
    sanitized += original.slice(cursor, start) + '[REDACTED]';
    cursor = end;
    redaction.count += 1;
    redaction.locations[location] = (redaction.locations[location] ?? 0) + 1;
  }
  if (cursor) value = sanitized + original.slice(cursor);
  replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]');
  replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [REDACTED]');
  replace(/(^|[^A-Za-z0-9])((?:github[_-]?token|aws[_-]?secret[_-]?access[_-]?key|password|passwd|secret|token|api[_-]?(?:key|token)|authorization|cookie|access[_-]?(?:token|key)|client[_-]?secret|private[_-]?key))(\s*(?:[:=]\s*|\s+))(?:\\(["'])(.*?)\\\4|(["'])(.*?)\6|[^\s,;]+)/gi, (_match, beforeKey, key, separator) => `${beforeKey}${key}${separator}[REDACTED]`);
  for (const source of redaction.patterns) {
    const pattern = new RegExp(source, 'g');
    value = value.replace(pattern, () => {
      redaction.count += 1;
      redaction.locations[location] = (redaction.locations[location] ?? 0) + 1;
      return '[REDACTED]';
    });
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function runGit(repo, args) {
  const result = await new Promise((resolveResult) => {
    const child = spawn('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let error;
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (caught) => { error = caught; });
    child.on('close', (code) => resolveResult({ code, error: error?.message, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
  return result;
}

async function gitIdentity(repo, redaction) {
  const result = await runGit(repo, ['rev-parse', 'HEAD']);
  return result.code === 0
    ? { commit: result.stdout.toString('utf8').trim() }
    : { commit: null, identityError: sanitizeText(result.error || result.stderr.toString('utf8').trim() || 'git rev-parse failed', redaction, 'git.identityError') };
}

const sourceExtensions = new Set(['.c', '.cc', '.cpp', '.cjs', '.css', '.go', '.h', '.html', '.java', '.js', '.json', '.jsonc', '.jsx', '.kt', '.m', '.mjs', '.mm', '.py', '.rb', '.rs', '.sass', '.scss', '.sh', '.swift', '.ts', '.tsx', '.toml', '.vue', '.yaml', '.yml', '.zsh', '.rules', '.webmanifest']);
const omittedFiles = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']);

function isSourceOrTestFile(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => ['.git', 'node_modules', 'dist', 'build', 'coverage'].includes(part))) return false;
  const basename = path.posix.basename(normalized);
  if (omittedFiles.has(basename)) return false;
  return sourceExtensions.has(path.posix.extname(basename).toLowerCase())
    || /(^|\/)(?:tests?|__tests__|specs?)(\/|$)/i.test(normalized)
    || /\.(?:test|spec)\.[^.]+$/i.test(basename);
}

function parseStatus(statusOutput) {
  const parts = statusOutput.toString('utf8').split('\0');
  const files = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (!entry) continue;
    const statusCode = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (!filePath) continue;
    const compactStatus = statusCode.trim();
    const status = statusCode === '??' ? 'untracked'
      : compactStatus.includes('A') ? 'added'
        : compactStatus.includes('D') ? 'deleted'
          : compactStatus.includes('R') ? 'renamed'
            : compactStatus.includes('C') ? 'copied'
              : compactStatus.includes('T') ? 'type-changed'
                : compactStatus.includes('M') ? 'modified' : compactStatus || 'unknown';
    const previousPath = statusCode.includes('R') || statusCode.includes('C') ? parts[++index] : undefined;
    files.push({ filePath, status, statusCode, ...(previousPath ? { previousPath } : {}) });
  }
  return files;
}

function shouldOmitContent(filePath) {
  const basename = path.posix.basename(filePath).toLowerCase();
  return basename === '.env' || basename.startsWith('.env.') || basename.startsWith('credentials')
    || basename.startsWith('secret') || /(?:\.pem|\.key|\.p12|\.pfx)$/.test(basename)
    || /^(?:id_rsa|id_ed25519)$/.test(basename);
}

function sanitizeCommandArguments(args, redaction) {
  const sensitiveOption = /^--?(?:github[_-]?token|aws[_-]?secret[_-]?access[_-]?key|password|passwd|secret|token|api[_-]?(?:key|token)|authorization|cookie|access[_-]?(?:token|key)|client[_-]?secret|private[_-]?key)$/i;
  let redactNext = false;
  return args.map((argument, index) => {
    if (redactNext) {
      redaction.count += 1;
      const location = `command.args[${index}]`;
      redaction.locations[location] = (redaction.locations[location] ?? 0) + 1;
      redactNext = false;
      return '[REDACTED]';
    }
    const sanitized = sanitizeText(argument, redaction, `command.args[${index}]`);
    redactNext = sensitiveOption.test(argument);
    return sanitized;
  });
}

async function collectSourceTestState(repo, redaction) {
  const scope = 'all-git-reported-nonignored-changes';
  const status = await runGit(repo, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  if (status.code !== 0) {
    const message = status.error || status.stderr.toString('utf8').trim() || 'git status failed';
    return { sourceTestFiles: [], sourceTestDiffSha256: sha256(''), identity: { status: 'incomplete', scope }, captureError: sanitizeText(message, redaction, 'workingTree.captureError') };
  }
  const sourceTestFiles = [];
  const identities = [];
  let complete = true;
  for (const change of parseStatus(status.stdout)) {
    let content = null;
    let contentKind = 'file';
    let contentOmitted;
    let contentError;
    let actualBytesSha256;
    const sensitiveName = shouldOmitContent(change.filePath) || shouldOmitContent(change.previousPath ?? '');
    const display = isSourceOrTestFile(change.filePath) && !sensitiveName;
    try {
      const fullPath = path.join(repo, change.filePath);
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) {
        contentKind = 'symbolic-link';
        const target = await readlink(fullPath, { encoding: 'buffer' });
        actualBytesSha256 = sha256(target);
        if (display) content = sanitizeText(target.toString('utf8'), redaction, 'workingTree.symlinkTarget');
        else contentOmitted = 'opaque-only';
      } else if (!info.isFile()) { contentOmitted = 'non-regular-file'; complete = false; }
      else {
        const bytes = await readFile(fullPath);
        actualBytesSha256 = sha256(bytes);
        if (sensitiveName) contentOmitted = 'sensitive-filename';
        else if (bytes.includes(0)) contentOmitted = 'binary-file';
        else if (!display) contentOmitted = 'opaque-only';
        else content = sanitizeText(bytes.toString('utf8'), redaction, 'workingTree.content');
      }
    } catch (error) {
      if (error?.code === 'ENOENT') contentOmitted = 'deleted-file';
      else {
        complete = false;
        contentOmitted = 'unreadable-file';
        contentError = sanitizeText(error instanceof Error ? error.message : String(error), redaction, 'workingTree.contentError');
      }
    }
    const empty = { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    const paths = [change.filePath, ...(change.previousPath ? [change.previousPath] : [])];
    const [diffResult, indexResult] = change.status === 'untracked' ? [empty, empty] : await Promise.all([
      runGit(repo, ['diff', '--binary', '--no-ext-diff', '--no-color', 'HEAD', '--', ...paths]),
      runGit(repo, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-color', 'HEAD', '--', ...paths]),
    ]);
    const diffError = [diffResult, indexResult].find(result => result.code !== 0);
    if (diffError) complete = false;
    const identity = {
      path: change.filePath, previousPath: change.previousPath, statusCode: change.statusCode,
      contentKind, actualBytesSha256, contentOmitted,
      actualDiffSha256: diffResult.code === 0 ? sha256(diffResult.stdout) : null,
      indexDiffSha256: indexResult.code === 0 ? sha256(indexResult.stdout) : null,
    };
    identities.push(identity);
    const binaryDiff = diffResult.stdout.includes(Buffer.from('GIT binary patch'));
    const diffText = display && contentOmitted !== 'binary-file' && !binaryDiff && diffResult.code === 0
      ? sanitizeText(diffResult.stdout.toString('utf8'), redaction, 'workingTree.diff') : '';
    sourceTestFiles.push({
      ...identity,
      path: sanitizeText(change.filePath, redaction, 'workingTree.path'),
      ...(change.previousPath ? { previousPath: sanitizeText(change.previousPath, redaction, 'workingTree.previousPath') } : {}),
      status: change.status,
      ...(contentError ? { contentError } : {}),
      ...(content === null ? { content: null, contentOmitted } : { content, sha256: sha256(content) }),
      ...(diffText ? { diff: diffText, diffSha256: sha256(diffText) } : {}),
      ...(diffError ? { diffCaptureError: sanitizeText(diffError.error || diffError.stderr.toString('utf8').trim() || 'git diff failed', redaction, 'workingTree.diffError') } : {}),
    });
  }
  return {
    sourceTestFiles,
    sourceTestDiffSha256: sha256(JSON.stringify(identities)),
    identity: { status: complete ? 'complete' : 'incomplete', scope, exclusions: ['Git-ignored files', 'environment and external runtime state'], hashBasis: 'actual path, status, file or symlink bytes, HEAD diff and staged diff; no raw payloads persisted' },
  };
}

async function writeRecord(filePath, record) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

async function execute(command, args, cwd) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const stdout = [];
    const stderr = [];
    let launchError;
    let wrapperSignal = null;
    let childClosed = false;
    let cleanupTimer;
    let resultOnClose;
    let interruption;
    const cleanup = {
      scope: process.platform === 'win32' ? 'direct-child' : 'owned-process-group',
      signalSent: false,
      escalated: false,
      graceMs: cleanupGraceMs,
      completed: false,
    };
    const sendOwnedSignal = (signal) => {
      if (!child.pid) return false;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
        return true;
      } catch (error) {
        if (error?.code === 'ESRCH') return false;
        cleanup.error = error instanceof Error ? error.message : String(error);
        return false;
      }
    };
    const finish = () => {
      if (!childClosed || (wrapperSignal && !interruption?.cleanup.graceElapsed)) return;
      if (wrapperSignal) cleanup.completed = true;
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      resolveResult({ ...resultOnClose, interruption });
    };
    const onSignal = (signal) => {
      if (wrapperSignal) return;
      wrapperSignal = signal;
      interruption = { signal, receivedAt: new Date().toISOString(), cleanup };
      cleanup.signalSent = sendOwnedSignal(signal);
      cleanupTimer = setTimeout(() => {
        const killSent = sendOwnedSignal('SIGKILL');
        cleanup.escalated = killSent;
        cleanup.graceElapsed = true;
        finish();
      }, cleanupGraceMs);
    };
    const onSigint = () => onSignal('SIGINT');
    const onSigterm = () => onSignal('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => { launchError = error; });
    child.once('spawn', () => {
      if (wrapperSignal && !cleanup.signalSent) cleanup.signalSent = sendOwnedSignal(wrapperSignal);
    });
    child.on('close', (code, signal) => {
      childClosed = true;
      resultOnClose = {
        finishedAt: new Date().toISOString(),
        exitCode: launchError ? 127 : code,
        signal,
        launchError: launchError ? { message: launchError.message, code: launchError.code } : null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (!wrapperSignal && signal) {
        wrapperSignal = signal;
        interruption = { signal, receivedAt: resultOnClose.finishedAt, source: 'child-process', cleanup };
        cleanup.signalSent = sendOwnedSignal(signal === 'SIGKILL' ? 'SIGTERM' : signal);
        cleanupTimer = setTimeout(() => {
          cleanup.escalated = sendOwnedSignal('SIGKILL');
          cleanup.graceElapsed = true;
          finish();
        }, cleanupGraceMs);
      } else if (!wrapperSignal) {
        cleanup.completed = true;
      }
      finish();
    });
  });
}

function classifyExecution(result) {
  if (result.interruption) return { outcome: 'interrupted', basis: `wrapper-signal:${result.interruption.signal}` };
  if (result.launchError) return { outcome: 'launch-failure', basis: `spawn-error:${result.launchError.code ?? 'unknown'}` };
  if (result.signal) return { outcome: 'interrupted', basis: `process-signal:${result.signal}` };
  if (result.exitCode === 0) return { outcome: 'passed', basis: 'exit-code:0' };
  const output = `${result.stdout}\n${result.stderr}`;
  if (/\bSyntaxError\b|ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|ModuleNotFoundError|ImportError|command not found|\bENOENT\b|\bEACCES\b/i.test(output)) {
    return { outcome: 'infrastructure-failure', basis: 'recognized-launch-syntax-or-import-output' };
  }
  if (/\bAssertionError\b|\bERR_ASSERTION\b|\bassertion failed\b/i.test(output)) {
    return { outcome: 'assertion-failure', basis: 'recognized-assertion-output' };
  }
  return { outcome: 'nonzero-exit', basis: `exit-code:${result.exitCode}` };
}

async function main(argv) {
  const { options, command, commandArgs } = parseArguments(argv);
  const redaction = { count: 0, locations: {}, patterns: options['redact-pattern'] ?? [] };
  const prepared = new Date();
  const id = `${prepared.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const repo = path.resolve(options.repo);
  const evidenceDirectory = path.resolve(options['evidence-dir']);
  const recordPath = path.join(evidenceDirectory, `${id}.json`);
  if (Boolean(options['correction-of']) !== Boolean(options['correction-note'])) {
    throw new Error('--correction-of and --correction-note must be supplied together.');
  }
  let correction;
  if (options['correction-of']) {
    const originalRecordId = options['correction-of'];
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}$/.test(originalRecordId)) {
      throw new Error('--correction-of must be a record ID from this evidence directory.');
    }
    const originalPath = path.join(evidenceDirectory, `${originalRecordId}.json`);
    let original;
    try {
      original = JSON.parse(await readFile(originalPath, 'utf8'));
    } catch {
      throw new Error(`No original record found for correction ID ${originalRecordId}.`);
    }
    if (original.id !== originalRecordId) throw new Error(`Record ID does not match correction target ${originalRecordId}.`);
    correction = {
      originalRecordId,
      note: sanitizeText(options['correction-note'], redaction, 'correction.note'),
    };
  }
  for (const pattern of redaction.patterns) {
    try { new RegExp(pattern); } catch (error) { throw new Error(`Invalid --redact-pattern: ${error.message}`); }
  }
  const git = await gitIdentity(repo, redaction);
  const workingTree = await collectSourceTestState(repo, redaction);
  const record = {
    schemaVersion: 1,
    id,
    state: 'prepared',
    declaredPurpose: options.purpose,
    preparedAt: prepared.toISOString(),
    startedAt: null,
    finishedAt: null,
    finalizedAt: null,
    ...(correction ? { correction } : {}),
    repository: sanitizeText(repo, redaction, 'repository'),
    workingDirectory: sanitizeText(repo, redaction, 'workingDirectory'),
    git,
    workingTree,
    command: {
      executable: sanitizeText(command, redaction, 'command.executable'),
      args: sanitizeCommandArguments(commandArgs, redaction),
    },
    execution: {
      outcome: 'not-started',
      exitCode: null,
      signal: null,
      output: { stdout: '', stderr: '' },
      outputSha256: sha256(JSON.stringify({ stdout: '', stderr: '' })),
    },
    redaction: { applied: redaction.count > 0, count: redaction.count, locations: { ...redaction.locations } },
    provenanceLimits,
  };

  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await writeRecord(recordPath, record);
  record.startedAt = new Date().toISOString();
  record.state = 'running';
  record.execution.outcome = 'running';
  await writeRecord(recordPath, record);
  process.stderr.write(`record-run: evidence=${recordPath}\n`);

  const result = await execute(command, commandArgs, repo);
  const signalNumber = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }[result.interruption?.signal ?? result.signal];
  const wrapperExitCode = result.interruption || result.signal
    ? 128 + (signalNumber ?? 1)
    : result.exitCode ?? 1;
  const output = {
    stdout: sanitizeText(result.stdout, redaction, 'execution.stdout'),
    stderr: sanitizeText(result.stderr, redaction, 'execution.stderr'),
  };
  record.state = result.interruption || result.signal ? 'incomplete' : 'complete';
  record.finishedAt = result.finishedAt ?? new Date().toISOString();
  record.finalizedAt = new Date().toISOString();
  if (result.interruption) {
    if (result.interruption.cleanup.error) {
      result.interruption.cleanup.error = sanitizeText(result.interruption.cleanup.error, redaction, 'interruption.cleanup.error');
    }
    record.interruption = result.interruption;
  } else if (result.signal) {
    record.interruption = {
      signal: result.signal,
      receivedAt: record.finishedAt,
      source: 'child-process',
      cleanup: { scope: process.platform === 'win32' ? 'direct-child' : 'owned-process-group', signalSent: false, escalated: false, completed: false },
    };
  }
  record.execution = {
    ...classifyExecution(result),
    exitCode: result.exitCode,
    wrapperExitCode,
    signal: result.signal,
    ...(result.launchError ? { launchError: sanitizeText(result.launchError.message, redaction, 'execution.launchError'), launchErrorCode: result.launchError.code ?? null } : {}),
    output,
    outputSha256: sha256(JSON.stringify(output)),
  };
  record.redaction = { applied: redaction.count > 0, count: redaction.count, locations: { ...redaction.locations } };
  await writeRecord(recordPath, record);
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  process.stderr.write(`record-run: purpose=${options.purpose} outcome=${record.execution.outcome} exit=${wrapperExitCode} childExit=${result.exitCode}\n`);
  process.exitCode = wrapperExitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`record-run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
