#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { assertDiagnosticLaunchAllowed, admitDiagnosticAttempt, finishDiagnosticAttempt } from './checkpoint-progress.mjs';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, stat, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBase } from './preflight.mjs';
import { parseTap } from '../test-groups.mjs';
import { planQualificationContracts, qualificationTestCommand, verifyQualificationOutcomes } from './qualification-contracts.mjs';

const purposes = new Set(['preimplementation-red', 'later-baseline-sensitivity', 'green']);
const cleanupGraceMs = 750;
const evidenceFailureExitCode = 74;
const provenanceLimits = [
  'Generated metadata is not tamper-proof attestation.',
  'The declared purpose does not prove when a test was authored.',
  'The recorder does not automatically judge whether a RED is meaningful.',
];
const localFixtureId = 'early-group-aggregate';
const localFixtureTestName = 'group and aggregate retain actual early cases once across fresh group processes';
const localFixtureNestedTestNames = [
  'known completed partial action remains accounted without full coverage credit',
  ...['missing accounting', 'unknown offered ID', 'unknown executed ID', 'profile tamper', 'source tamper', 'transport failure', 'instrumentation failure', 'cleanup failure'].map(name => `failed stress still refuses ${name}`),
  'changed group transfer reference',
  'missing durable predecessor',
];
const supportedNodeMajor = 22;
const maximumCoordinationLeaseMs = 90_000;
const localFixtureScrubbedEnvironmentKeys = [
  /^CI$/i,
  /^CONTINUOUS_INTEGRATION$/i,
  /^GITHUB_/i,
  /^ACTIONS_/i,
  /^NODE_(?:OPTIONS|PATH|INSPECT|V8_COVERAGE)$/i,
  /^NPM_CONFIG_/i,
  /^PLAYWRIGHT_/i,
  /^PUPPETEER_/i,
  /^(?:CHROME|CHROMIUM|FIREFOX|WEBKIT|BROWSER)(?:_|$)/i,
  /^(?:FIREBASE|GCLOUD|GOOGLE|AWS|AZURE|CLOUDSDK|DOCKER)_/i,
  /^CHAIN_/i,
  /^DOW_EMULATOR_COORDINATION_FILE$/i,
  /^TMPDIR$/i,
  /^TMP$/i,
  /^TEMP$/i,
  /^HOME$/i,
  /^XDG_(?:CONFIG|CACHE|DATA|STATE|RUNTIME)_HOME$/i,
];

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (argv.includes('--help')) throw new Error('--help must be provided alone.');
  const fixtureFlags = argv.reduce((matches, value, index) => value === '--local-fixture' ? [...matches, index] : matches, []);
  if (fixtureFlags.length) {
    if (fixtureFlags.length !== 1) throw new Error('--local-fixture may be provided only once.');
    if (argv.includes('--')) throw new Error('--local-fixture owns its fixed child command and cannot be combined with -- <command>.');
    const options = {};
    const seen = new Set();
    for (let index = 0; index < argv.length; index += 1) {
      const name = argv[index];
      if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`);
      if (name === '--summary') {
        if (seen.has(name)) throw new Error('--summary may be provided only once.');
        seen.add(name);
        options.summary = true;
        continue;
      }
      const key = name.slice(2);
      if (!['local-fixture', 'repo', 'evidence-dir', 'purpose', 'redact-pattern'].includes(key)) {
        throw new Error(`Unsupported option for --local-fixture: ${name}`);
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
      if (key === 'redact-pattern') options[key] = [...(options[key] ?? []), value];
      else {
        if (seen.has(name)) throw new Error(`${name} may be provided only once.`);
        seen.add(name);
        options[key] = value;
      }
      index += 1;
    }
    if (options['local-fixture'] !== localFixtureId) {
      throw new Error(`--local-fixture must be ${localFixtureId}.`);
    }
    if (!options.repo) throw new Error('Required option: --repo <worktree>.');
    if (!options['evidence-dir']) throw new Error('Required option: --evidence-dir <directory>.');
    if (options.purpose !== 'green') throw new Error('The supported local fixture requires --purpose green.');
    if (!options.summary) throw new Error('The supported local fixture requires --summary for its bounded result and cleanup report.');
    return {
      options: { ...options, localFixture: options['local-fixture'] },
      localFixture: true,
      command: process.execPath,
      commandArgs: ['--test', `--test-name-pattern=^${localFixtureTestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'scripts/agent-tools/test-groups.test.mjs'],
    };
  }
  const separator = argv.indexOf('--');
  if (separator < 0) throw new Error('Expected -- before the child command.');
  const options = {};
  for (let index = 0; index < separator; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--')) throw new Error(`Unexpected option: ${name}`);
    if (name === '--summary') {
      options.summary = true;
      continue;
    }
    if (name === '--qualification-readiness') {
      if (options.qualificationReadiness) throw new Error('--qualification-readiness may be provided only once.');
      options.qualificationReadiness = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
    const key = name.slice(2);
    if (!['repo', 'evidence-dir', 'purpose', 'redact-pattern', 'correction-of', 'correction-note', 'diagnostic-request', 'diagnostic-task', 'qualification-base'].includes(key)) throw new Error(`Unknown option: ${name}`);
    if (key === 'redact-pattern') options[key] = [...(options[key] ?? []), value];
    else if (key === 'qualification-base') {
      if (options[key] !== undefined) throw new Error(`${name} may be provided only once.`);
      options[key] = value;
    } else options[key] = value;
    index += 1;
  }
  const command = argv[separator + 1];
  if (!command) throw new Error('Expected a child command after --.');
  if (!options.repo) throw new Error('Required option: --repo <worktree>.');
  if (!options['evidence-dir']) throw new Error('Required option: --evidence-dir <directory>.');
  if (!purposes.has(options.purpose)) throw new Error(`Required --purpose must be one of: ${[...purposes].join(', ')}.`);
  if (options['qualification-base'] && !options.qualificationReadiness) throw new Error('--qualification-base requires --qualification-readiness.');
  return { options, command, commandArgs: argv.slice(separator + 2) };
}

function sanitizeText(input, redaction, location = 'metadata') {
  let value = String(input);
  const replace = (pattern, replacement) => {
    value = value.replace(pattern, (...args) => {
      const sanitized = typeof replacement === 'function' ? replacement(...args) : replacement;
      if (sanitized === undefined) return args[0];
      redaction.count += 1;
      redaction.locations[location] = (redaction.locations[location] ?? 0) + 1;
      return sanitized;
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
  const isTapIdentityLine = (source, offset) => {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = source.indexOf('\n', offset);
    const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
    return /^[ \t]*(?:# Subtest: |(?:not )?ok \d+ - )/.test(line);
  };
  // Generic key/value separators stay on one line so they cannot consume TAP controls.
  replace(/(^|[^A-Za-z0-9])((?:github[_-]?token|aws[_-]?secret[_-]?access[_-]?key|password|passwd|secret|token|api[_-]?(?:key|token)|authorization|cookie|access[_-]?(?:token|key)|client[_-]?secret|private[_-]?key))([ \t]*(?:[:=][ \t]*|[ \t]+))(?:\\(["'])(.*?)\\\4|(["'])(.*?)\6|[^\s,;]+)/gi, (_match, beforeKey, key, separator, _escapedQuote, _escapedValue, _quote, _value, offset, source) => {
    // Bare `token <word>` text is also ordinary prose in TAP case names. Keep
    // that identity intact, while still redacting explicit key/value forms,
    // recognizable token credentials, custom patterns, and all non-TAP logs.
    if (key.toLowerCase() === 'token' && !/[:=]/.test(separator) && isTapIdentityLine(source, offset)) return undefined;
    return `${beforeKey}${key}${separator}[REDACTED]`;
  });
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

async function runGit(repo, args, environment = process.env) {
  const result = await new Promise((resolveResult) => {
    const child = spawn('git', ['-C', repo, ...args], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function gitIdentity(repo, redaction, environment = process.env) {
  const result = await runGit(repo, ['rev-parse', 'HEAD'], environment);
  return result.code === 0
    ? { commit: result.stdout.toString('utf8').trim() }
    : { commit: null, identityError: sanitizeText(result.error || result.stderr.toString('utf8').trim() || 'git rev-parse failed', redaction, 'git.identityError') };
}

function pathContains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveFuturePath(candidate) {
  let ancestor = candidate;
  const suffix = [];
  while (true) {
    try {
      await lstat(ancestor);
      return path.join(await realpath(ancestor), ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

async function ensureWritableDirectory(candidate, label) {
  try {
    await mkdir(candidate, { recursive: true, mode: 0o700 });
    const info = await stat(candidate);
    if (!info.isDirectory()) throw new Error('destination is not a directory');
    const directory = await realpath(candidate);
    const probePath = path.join(directory, `.record-run-readiness-${randomUUID()}`);
    const probe = await open(probePath, 'wx', 0o600);
    try {
      await probe.writeFile('qualification readiness probe');
      await probe.sync();
    } finally {
      await probe.close();
      await unlink(probePath);
    }
    return directory;
  } catch (error) {
    throw new Error(`${label} must be a writable directory (${error instanceof Error ? error.message : String(error)}).`, { cause: error });
  }
}

async function gitValue(repo, args, label, environment = process.env) {
  const result = await runGit(repo, args, environment);
  if (result.code !== 0) throw new Error(`${label} could not be read from the committed worktree.`);
  return result.stdout.toString('utf8').trim();
}

async function canonicalWorktreePath(value) {
  const candidate = path.resolve(String(value ?? ''));
  try { return await realpath(candidate); } catch { return candidate; }
}

function configuredCoordinationPath(environment) {
  const canonical = environment.CODEX_COORDINATION_FILE?.trim();
  const legacy = environment.DOW_EMULATOR_COORDINATION_FILE?.trim();
  const canonicalPath = canonical ? path.resolve(canonical) : undefined;
  const legacyPath = legacy ? path.resolve(legacy) : undefined;
  if (canonicalPath && legacyPath && canonicalPath !== legacyPath) {
    throw new Error(`Conflicting coordination paths: CODEX_COORDINATION_FILE selects ${canonicalPath}, while DOW_EMULATOR_COORDINATION_FILE selects ${legacyPath}.`);
  }
  const selected = canonicalPath ?? legacyPath;
  if (!selected) throw new Error('Qualification readiness requires CODEX_COORDINATION_FILE (or its DOW_EMULATOR_COORDINATION_FILE compatibility alias) to select the live host ledger.');
  return selected;
}

function requirePort(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error(`${name} must be an explicit locally allocated TCP port from 1 through 65535.`);
  }
  return Number(value);
}

function healthyLeaseSnapshot(owner, now = Date.now()) {
  const lease = owner?.lease;
  if (owner?.status !== 'active' || lease?.state !== 'healthy'
    || lease.ownerConfirmationRequired !== false || lease.takeoverAllowed !== false) {
    throw new Error('The active host coordination entry must have a healthy owner-confirmed lease.');
  }
  const heartbeat = Date.parse(lease.lastHeartbeatAt);
  const entryHeartbeat = Date.parse(owner.heartbeatAt);
  const expires = Date.parse(lease.expiresAt);
  if (!Number.isFinite(heartbeat) || !Number.isFinite(entryHeartbeat) || !Number.isFinite(expires)
    || Math.abs(heartbeat - entryHeartbeat) > 1000 || heartbeat > now + 5000
    || now - heartbeat > maximumCoordinationLeaseMs || expires <= now
    || expires <= heartbeat || expires - heartbeat > maximumCoordinationLeaseMs + 5000) {
    throw new Error('The active host coordination lease is missing, stale, or expired. Refresh the owner heartbeat and retry.');
  }
  return structuredClone(lease);
}

async function validateHostPortOwnership(environment, worktree, ports) {
  const filePath = configuredCoordinationPath(environment);
  let state;
  try {
    state = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read live host coordination ledger at ${filePath}: ${error instanceof Error ? error.message : String(error)}.`, { cause: error });
  }
  if (!state || typeof state !== 'object' || state.version !== 1 || state.scope !== 'codex-wide' || !Array.isArray(state.entries)) {
    throw new Error(`Live host coordination ledger at ${filePath} is not a valid codex-wide v1 ledger.`);
  }
  const activeEntries = state.entries.filter((entry) => entry && ['active', 'parked'].includes(entry.status));
  const activeWorktreeEntries = [];
  for (const entry of activeEntries) {
    if (entry.status === 'active' && entry.worktree && await canonicalWorktreePath(entry.worktree) === worktree) {
      activeWorktreeEntries.push(entry);
    }
  }
  if (activeWorktreeEntries.length !== 1) {
    throw new Error(`Qualification readiness requires exactly one active host coordination entry for this worktree; found ${activeWorktreeEntries.length}.`);
  }
  const owner = activeWorktreeEntries[0];
  if (typeof owner.id !== 'string' || !owner.id.trim()) {
    throw new Error('The active host coordination entry for this worktree has no valid owner ID.');
  }
  const lease = healthyLeaseSnapshot(owner);
  const requiredResources = ports.map(({ name, port }) => ({ name, port, resource: `loopback:127.0.0.1:${port}` }));
  for (const { name: variable, resource } of requiredResources) {
    const ownsResource = (entry) => Array.isArray(entry.resources)
      && entry.resources.some((item) => String(item).trim().toLowerCase() === resource);
    if (!ownsResource(owner)) {
      throw new Error(`${variable} resource ${resource} is not allocated to the active worktree in the live host coordination ledger.`);
    }
    const otherOwner = activeEntries.find((entry) => entry !== owner && ownsResource(entry));
    if (otherOwner) {
      throw new Error(`${variable} resource ${resource} is already owned by another active or parked worktree (${otherOwner.worktree ?? 'unknown worktree'}).`);
    }
  }
  return {
    filePath,
    ownerId: owner.id,
    worktree,
    lease,
    leaseSha256: sha256(JSON.stringify(lease)),
    resources: requiredResources.map(({ resource }) => resource),
  };
}

export async function validateQualificationReadiness({ repo, evidenceDirectory, environment = process.env, localFixture = false }) {
  const repository = await realpath(repo).catch((error) => {
    throw new Error(`Qualification readiness cannot resolve --repo ${repo}: ${error.message}.`, { cause: error });
  });
  const topLevel = await gitValue(repo, ['rev-parse', '--show-toplevel'], 'Git worktree root', environment);
  const actualRoot = await realpath(topLevel);
  if (repository !== actualRoot) throw new Error(`Qualification readiness requires --repo to name the Git worktree root (${actualRoot}).`);

  const commit = await gitValue(repo, ['rev-parse', 'HEAD^{commit}'], 'Committed candidate SHA', environment);
  const tree = await gitValue(repo, ['rev-parse', 'HEAD^{tree}'], 'Committed candidate tree', environment);
  if (environment.CHAIN_NATIVE_CANDIDATE_SHA !== commit) {
    throw new Error(`CHAIN_NATIVE_CANDIDATE_SHA must exactly match committed HEAD (${commit}).`);
  }
  if (environment.CHAIN_NATIVE_CANDIDATE_TREE !== tree) {
    throw new Error(`CHAIN_NATIVE_CANDIDATE_TREE must exactly match committed HEAD tree (${tree}).`);
  }
  const status = await runGit(repo, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], environment);
  if (status.code !== 0) throw new Error('Qualification readiness could not verify the committed worktree status.');
  if (status.stdout.length) throw new Error('Qualification readiness requires the committed candidate working tree to be clean.');

  if (environment.CI === 'true') {
    throw new Error('CI=true cannot be used for local qualification: native smoke switches to ephemeral port 0 and ignores the allocated CHAIN_NATIVE_SMOKE_PORT.');
  }
  if (localFixture && !environment.CODEX_COORDINATION_FILE?.trim()) {
    throw new Error('The local fixture requires CODEX_COORDINATION_FILE to select the canonical host ledger.');
  }
  const ports = [{ name: 'CHAIN_NATIVE_PORT', port: requirePort(environment, 'CHAIN_NATIVE_PORT') }];
  if (!localFixture) {
    ports.push({ name: 'CHAIN_NATIVE_SMOKE_PORT', port: requirePort(environment, 'CHAIN_NATIVE_SMOKE_PORT') });
    if (ports[0].port === ports[1].port) throw new Error('CHAIN_NATIVE_PORT and CHAIN_NATIVE_SMOKE_PORT must be distinct ports.');
  }
  const ownership = await validateHostPortOwnership(environment, repository, ports);

  const nativeOutputValue = environment.CHAIN_NATIVE_OUTPUT;
  if (typeof nativeOutputValue !== 'string' || !path.isAbsolute(nativeOutputValue)) {
    throw new Error('CHAIN_NATIVE_OUTPUT must be an absolute, durable evidence directory.');
  }
  const nativeOutputCandidate = path.resolve(nativeOutputValue);
  const evidenceCandidate = path.resolve(evidenceDirectory);
  const [resolvedEvidence, resolvedNativeOutput] = await Promise.all([
    resolveFuturePath(evidenceCandidate),
    resolveFuturePath(nativeOutputCandidate),
  ]);
  if (pathContains(repository, resolvedEvidence) || pathContains(repository, resolvedNativeOutput)) {
    throw new Error('Qualification evidence destinations must be outside the candidate Git worktree.');
  }
  if (pathContains(resolvedEvidence, resolvedNativeOutput) || pathContains(resolvedNativeOutput, resolvedEvidence)) {
    throw new Error('Recorder evidence and CHAIN_NATIVE_OUTPUT must be separate, non-overlapping directories.');
  }
  const [actualEvidence, actualNativeOutput] = await Promise.all([
    ensureWritableDirectory(evidenceCandidate, 'Recorder evidence destination'),
    ensureWritableDirectory(nativeOutputCandidate, 'CHAIN_NATIVE_OUTPUT evidence destination'),
  ]);
  if (pathContains(repository, actualEvidence) || pathContains(repository, actualNativeOutput)) {
    throw new Error('Qualification evidence destinations must resolve outside the candidate Git worktree.');
  }
  if (pathContains(actualEvidence, actualNativeOutput) || pathContains(actualNativeOutput, actualEvidence)) {
    throw new Error('Recorder evidence and CHAIN_NATIVE_OUTPUT must be separate, non-overlapping directories.');
  }
  return {
    repository,
    commit,
    tree,
    evidenceDirectory: actualEvidence,
    nativeOutputDirectory: actualNativeOutput,
    ownership,
  };
}

function localFixtureBaseEnvironment({ environment, evidenceDirectory, attemptId }) {
  if (Number(process.versions.node.split('.')[0]) !== supportedNodeMajor) {
    throw new Error(`The supported local fixture requires the actual Node ${supportedNodeMajor} runtime; this recorder is ${process.version} at ${process.execPath}.`);
  }
  const coordinationFile = environment.CODEX_COORDINATION_FILE?.trim();
  if (!coordinationFile || !path.isAbsolute(coordinationFile)) {
    throw new Error('The local fixture requires an absolute CODEX_COORDINATION_FILE for the canonical host ledger.');
  }
  const originalPath = environment.PATH || '/usr/bin:/bin';
  const nodeDirectory = path.dirname(process.execPath);
  const env = {};
  for (const [key, value] of Object.entries(environment)) {
    if (localFixtureScrubbedEnvironmentKeys.some((pattern) => pattern.test(key))) continue;
    if (key === 'PATH' || key === 'LANG' || key === 'TERM' || key === 'SYSTEMROOT' || key === 'WINDIR'
      || key === 'COMSPEC' || key === 'PATHEXT' || /^LC_[A-Z0-9_]+$/i.test(key)) env[key] = value;
  }
  env.PATH = `${nodeDirectory}${path.delimiter}${originalPath}`;
  env.CODEX_COORDINATION_FILE = path.resolve(coordinationFile);
  env.CHAIN_NATIVE_OUTPUT = path.join(path.dirname(path.resolve(evidenceDirectory)), `${path.basename(path.resolve(evidenceDirectory))}-native-output-${attemptId}`);
  if (typeof environment.CHAIN_NATIVE_PORT === 'string') env.CHAIN_NATIVE_PORT = environment.CHAIN_NATIVE_PORT;
  return env;
}

async function createPrivateLocalFixtureRuntime(evidenceDirectory) {
  const root = path.join(path.dirname(evidenceDirectory), `.record-run-local-fixture-${randomUUID()}`);
  await mkdir(root, { mode: 0o700 });
  const directories = Object.fromEntries(['home', 'tmp', 'config', 'cache', 'data', 'state', 'runtime']
    .map((name) => [name, path.join(root, name)]));
  try {
    for (const directory of Object.values(directories)) await mkdir(directory, { mode: 0o700 });
    for (const [name, directory] of Object.entries({ root, ...directories })) {
      const info = await stat(directory);
      if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
        throw new Error(`Private local fixture ${name} directory must have owner-only access.`);
      }
    }
    return { root, directories };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function localFixtureChildEnvironment(base, runtime) {
  return {
    ...base,
    HOME: runtime.directories.home,
    TMPDIR: runtime.directories.tmp,
    TMP: runtime.directories.tmp,
    TEMP: runtime.directories.tmp,
    XDG_CONFIG_HOME: runtime.directories.config,
    XDG_CACHE_HOME: runtime.directories.cache,
    XDG_DATA_HOME: runtime.directories.data,
    XDG_STATE_HOME: runtime.directories.state,
    XDG_RUNTIME_DIR: runtime.directories.runtime,
  };
}

async function assertPrivateEvidenceDirectory(directory, label) {
  const info = await stat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private directory with owner-only access.`);
  }
}

async function assertLoopbackPortAvailable(port) {
  const server = net.createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  }).catch((error) => {
    throw new Error(`Allocated fixture listener port ${port} is unavailable before workload (${error.code ?? error.message}).`, { cause: error });
  });
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function revalidateFixtureOwnership(environment, snapshot) {
  const current = await validateHostPortOwnership(environment, snapshot.worktree, [
    { name: 'CHAIN_NATIVE_PORT', port: Number(snapshot.resources[0].split(':').at(-1)) },
  ]);
  if (current.ownerId !== snapshot.ownerId || current.leaseSha256 !== snapshot.leaseSha256
    || JSON.stringify(current.resources) !== JSON.stringify(snapshot.resources)) {
    throw new Error('The local fixture allocation identity changed after the child finished.');
  }
  return current;
}

function processGroupExists(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function cleanupOwnedProcessGroup(pid) {
  const cleanup = {
    scope: process.platform === 'win32' ? 'direct-child' : 'owned-process-group',
    pid: pid ?? null,
    signalSent: false,
    escalated: false,
    completed: false,
  };
  if (process.platform === 'win32') {
    cleanup.completed = true;
    return cleanup;
  }
  if (!pid) {
    cleanup.completed = true;
    return cleanup;
  }
  if (!processGroupExists(pid)) {
    cleanup.completed = true;
    return cleanup;
  }
  try {
    process.kill(-pid, 'SIGTERM');
    cleanup.signalSent = true;
  } catch (error) {
    if (error?.code !== 'ESRCH') cleanup.error = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  if (processGroupExists(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
      cleanup.escalated = true;
    } catch (error) {
      if (error?.code !== 'ESRCH') cleanup.error = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  }
  cleanup.completed = !processGroupExists(pid);
  return cleanup;
}

function releaseFixtureAllocation(snapshot, environment) {
  const coordination = fileURLToPath(new URL('./coordination.mjs', import.meta.url));
  const resource = snapshot.resources[0];
  const result = spawnSync(process.execPath, [coordination, 'release-claim', '--file', snapshot.filePath,
    '--id', snapshot.ownerId, '--resources', resource, '--expected-lease-sha256', snapshot.leaseSha256], {
    cwd: snapshot.worktree,
    env: environment,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error) return { status: 'unresolved', error: result.error.message, resource };
  if (result.status !== 0) return { status: 'unresolved', error: result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`, resource };
  try {
    const updated = JSON.parse(result.stdout);
    if (updated.id !== snapshot.ownerId || updated.worktree !== snapshot.worktree
      || updated.resources?.includes(resource)) {
      return { status: 'unresolved', error: 'coordination CLI returned an unexpected owner/resource state', resource };
    }
  } catch (error) {
    return { status: 'unresolved', error: `coordination CLI response could not be verified (${error.message})`, resource };
  }
  return { status: 'released', resource, ownerId: snapshot.ownerId, leaseSha256: snapshot.leaseSha256 };
}

async function finishLocalFixtureCleanup({ ownership, childEnvironment, pid, runtime, nativeOutputDirectory, port }) {
  const cleanup = {
    child: await cleanupOwnedProcessGroup(pid),
    listener: { status: 'unverified' },
    allocation: { status: 'not-released' },
    runtimeDirectory: { status: 'unresolved' },
  };
  try {
    await assertLoopbackPortAvailable(port);
    cleanup.listener = { status: 'closed', port };
  } catch (error) {
    cleanup.listener = { status: 'unresolved', port, error: error instanceof Error ? error.message : String(error) };
  }
  if (cleanup.child.completed && cleanup.listener.status === 'closed') {
    try {
      await revalidateFixtureOwnership(childEnvironment, ownership);
      cleanup.allocation = releaseFixtureAllocation(ownership, childEnvironment);
    } catch (error) {
      cleanup.allocation = { status: 'unresolved', resource: ownership.resources[0], error: error instanceof Error ? error.message : String(error) };
    }
  } else {
    cleanup.allocation = { status: 'not-released', resource: ownership.resources[0], reason: 'owned child family or listener cleanup is unresolved' };
  }
  if (cleanup.child.completed) {
    try {
      await rm(runtime.root, { recursive: true, force: true });
      cleanup.runtimeDirectory = { status: 'removed' };
    } catch (error) {
      cleanup.runtimeDirectory = { status: 'unresolved', error: error instanceof Error ? error.message : String(error) };
    }
  } else {
    cleanup.runtimeDirectory = { status: 'retained', reason: 'owned child process family is still active' };
  }
  return cleanup;
}

async function readFixtureProducer(outputDirectory, startedAt) {
  const found = [];
  const visit = async (directory, depth) => {
    if (depth > 5) return;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target, depth + 1);
      else if (entry.isFile() && /^button-safety-chromium-.*\.json$/.test(entry.name)) {
        const info = await stat(target);
        if (info.mtimeMs >= startedAt.getTime()) found.push({ target, mtimeMs: info.mtimeMs });
      }
    }
  };
  await visit(outputDirectory, 0);
  const latest = found.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest) return null;
  try {
    const value = JSON.parse(await readFile(latest.target, 'utf8'));
    return {
      artifactPath: latest.target,
      status: value.status ?? null,
      observedActions: value.observedActions ?? [],
      actionObservation: value.actionObservation ?? null,
      outcomes: value.outcomes ?? [],
      rapidOutcomes: value.rapidOutcomes ?? [],
      errors: value.errors ?? [],
      cleanup: value.cleanup ?? null,
      browserVersion: value.browserVersion ?? null,
    };
  } catch (error) {
    return { artifactPath: latest.target, readError: error instanceof Error ? error.message : String(error) };
  }
}

function localFixtureNestedOutcomes(stdout, execution, expectedPort) {
  const diagnostics = stdout.split(/\r?\n/).filter(line => line.startsWith('# '))
    .map(line => line.slice(2)).filter(line => line.includes('"scope":"Controlled OS-process transfer only; no native/runtime proof"'));
  let observed;
  try { if (diagnostics.length === 1) observed = JSON.parse(diagnostics[0]); } catch { /* Retain sanitized raw evidence without granting observation credit. */ }
  let cases = [];
  try { cases = parseTap(stdout); } catch { /* Missing or malformed TAP cannot prove execution. */ }
  const requiredIds = [localFixtureTestName, ...localFixtureNestedTestNames.map(name => `${localFixtureTestName} > ${name}`)];
  const exactExecution = cases.length === requiredIds.length && requiredIds.every(id =>
    cases.filter(item => item.id === id && item.status === 'passed').length === 1);
  const listenerObservations = Array.isArray(observed?.liveListenerObservations) ? observed.liveListenerObservations : [];
  const listener = listenerObservations.at(-1);
  const liveListener = {
    allocatedPort: expectedPort,
    observedPort: listener?.port ?? null,
    httpStatus: listener?.httpStatus ?? null,
    reachable: listener?.reachable ?? null,
    responseBodyVerified: listener?.htmlDocument === true || listener?.bodyMatches === true,
    matchesAllocation: listener?.port === expectedPort,
    observationCount: listenerObservations.length,
  };
  const completeObservation = observed?.earlyRootExecutions === 5 && observed?.uniqueEarlyRoots === 5
    && observed?.ordinaryGroups === 4 && observed?.aggregateCaseCount === 11
    && listenerObservations.length > 0 && listenerObservations.every(item => item?.port === expectedPort
      && item.httpStatus === 200 && item.reachable === true && (item.htmlDocument === true || item.bodyMatches === true));
  const passed = execution.exitCode === 0 && !execution.signal && !execution.interruption;
  return {
    testName: localFixtureTestName,
    status: passed ? exactExecution && completeObservation ? 'passed' : 'unverified' : execution.outcome,
    earlyRootExecutions: observed?.earlyRootExecutions ?? null,
    uniqueEarlyRoots: observed?.uniqueEarlyRoots ?? null,
    ordinaryGroups: observed?.ordinaryGroups ?? null,
    aggregateCaseCount: observed?.aggregateCaseCount ?? null,
    liveListener,
    controlledBoundary: 'Playwright chromium.launch is replaced by the fixture; no native browser engine or memory qualification runs.',
  };
}

function sanitizeFixtureValue(value, redaction, location) {
  if (typeof value === 'string') return sanitizeText(value, redaction, location);
  if (Array.isArray(value)) return value.map((item) => sanitizeFixtureValue(item, redaction, location));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeFixtureValue(item, redaction, `${location}.${key}`)]));
  }
  return value;
}

function usageText() {
  return [
    'Usage: record-run.mjs --repo <worktree> --evidence-dir <directory> --purpose <purpose> -- <command> [args...]',
    `       record-run.mjs --repo <worktree> --evidence-dir <directory> --purpose green --summary --local-fixture ${localFixtureId}`,
  ].join('\n');
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

async function collectSourceTestState(repo, redaction, environment = process.env) {
  const scope = 'all-git-reported-nonignored-changes';
  const status = await runGit(repo, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], environment);
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
      runGit(repo, ['diff', '--binary', '--no-ext-diff', '--no-color', 'HEAD', '--', ...paths], environment),
      runGit(repo, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-color', 'HEAD', '--', ...paths], environment),
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

async function writeOutputFile(filePath, output) {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(output, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function qualificationChildDetails(result) {
  if (!result) return null;
  return {
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    signal: result.signal ?? null,
    launchError: result.launchError ? { message: result.launchError.message, code: result.launchError.code ?? null } : null,
    interruption: result.interruption ? {
      signal: result.interruption.signal,
      source: result.interruption.source ?? 'recorder-signal',
      cleanup: result.interruption.cleanup,
    } : null,
  };
}

async function runQualificationPreflight({ repo, evidenceDirectory, id, requestedBase, git, redaction }) {
  let comparisonBase = null;
  let plan = null;
  let preflightResult = null;
  let contractsResult = null;
  let outcomes = null;
  let status = 'failed';
  let stage = 'comparison-base';
  const errors = [];
  try {
    comparisonBase = resolveBase(requestedBase, repo);
    stage = 'workflow-preflight';
    preflightResult = await execute(process.execPath, [path.join(repo, 'scripts/agent-tools/preflight.mjs'), '--base', comparisonBase], repo);
    if (preflightResult.interruption || preflightResult.signal) status = 'interrupted';
    else if (preflightResult.launchError || preflightResult.exitCode !== 0) status = 'failed';
    else {
      stage = 'selection';
      plan = planQualificationContracts({ repo, comparisonBase });
      if (plan.status === 'no_change') {
        status = 'no_change';
        stage = 'no-change';
      } else {
        stage = 'parent-contracts';
        const selectedCommand = qualificationTestCommand(plan);
        contractsResult = await execute(selectedCommand.executable, selectedCommand.args, repo);
        outcomes = verifyQualificationOutcomes(plan, {
          exitCode: contractsResult.exitCode,
          signal: contractsResult.signal ?? contractsResult.interruption?.signal ?? null,
          launchError: contractsResult.launchError,
          stdout: contractsResult.stdout,
        });
        if (contractsResult.interruption || contractsResult.signal) status = 'interrupted';
        else status = outcomes.status === 'passed' ? 'passed' : 'failed';
      }
    }
  } catch (error) {
    errors.push(summarizeEvidenceError(error, redaction, 'qualificationPreflight.error'));
    status = 'failed';
  }

  const reportRoot = path.join(evidenceDirectory, 'qualification-preflight');
  const reportDirectory = path.join(reportRoot, id);
  await mkdir(reportRoot, { recursive: true, mode: 0o700 });
  await chmod(reportRoot, 0o700);
  await mkdir(reportDirectory, { mode: 0o700 });
  await chmod(reportDirectory, 0o700);
  const reportPath = path.join(reportDirectory, 'report.json');
  const files = {
    preflightStdout: 'preflight.stdout.txt',
    preflightStderr: 'preflight.stderr.txt',
    contractsStdout: 'contracts.stdout.tap',
    contractsStderr: 'contracts.stderr.txt',
  };
  const preflightStdout = sanitizeText(preflightResult?.stdout ?? '', redaction, 'qualificationPreflight.preflight.stdout');
  const preflightStderr = sanitizeText(preflightResult?.stderr ?? '', redaction, 'qualificationPreflight.preflight.stderr');
  const contractsStdout = sanitizeText(contractsResult?.stdout ?? '', redaction, 'qualificationPreflight.contracts.stdout');
  const contractsStderr = sanitizeText(contractsResult?.stderr ?? '', redaction, 'qualificationPreflight.contracts.stderr');
  await Promise.all([
    writeOutputFile(path.join(reportDirectory, files.preflightStdout), preflightStdout),
    writeOutputFile(path.join(reportDirectory, files.preflightStderr), preflightStderr),
    writeOutputFile(path.join(reportDirectory, files.contractsStdout), contractsStdout),
    writeOutputFile(path.join(reportDirectory, files.contractsStderr), contractsStderr),
  ]);
  const report = {
    schemaVersion: 1,
    recorderRunId: id,
    status,
    stage,
    candidate: { sourceSha: plan?.sourceSha ?? git?.commit ?? null, sourceTree: plan?.sourceTree ?? null },
    comparisonBase,
    selection: plan ? {
      status: plan.status,
      selectionBasis: plan.selectionBasis,
      changedPaths: plan.changedPaths,
      selected: plan.selected,
      assignmentAuthority: plan.assignmentAuthority,
      planSha256: plan.planSha256,
    } : null,
    workflowPreflight: {
      ...qualificationChildDetails(preflightResult),
      stdoutFile: files.preflightStdout,
      stderrFile: files.preflightStderr,
    },
    contracts: plan?.status === 'selected' ? {
      ...qualificationChildDetails(contractsResult),
      stdout: contractsStdout,
      stdoutFile: files.contractsStdout,
      stderrFile: files.contractsStderr,
    } : null,
    outcomes,
    errors,
  };
  const serializedReport = sanitizeText(`${JSON.stringify(report, null, 2)}\n`, redaction, 'qualificationPreflight.report');
  await writeOutputFile(reportPath, serializedReport);
  const summary = {
    status,
    stage,
    sourceSha: plan?.sourceSha ?? git?.commit ?? null,
    comparisonBase,
    selectionStatus: plan?.status ?? null,
    selectedContractIds: plan?.selected.map(contract => contract.id) ?? [],
    changedPathCount: plan?.changedPaths.length ?? null,
    reportPath: sanitizeText(reportPath, redaction, 'qualificationPreflight.reportPath'),
  };
  return {
    summary,
    interruption: preflightResult?.interruption ?? contractsResult?.interruption ?? null,
    failed: status === 'failed' || status === 'interrupted',
  };
}

function summaryStatus(result, evidenceStatus) {
  if (evidenceStatus !== 'complete') return 'evidence-failure';
  if (result.interruption || result.signal) return 'interrupted';
  if (result.qualificationFailure) return 'qualification-failure';
  if (result.launchError) return 'launch-failure';
  if (!Number.isInteger(result.exitCode)) return 'unknown';
  return result.exitCode === 0 ? 'passed' : 'failed';
}

function emitSummary({ status, outcome, purpose, child, interruptionSignal = null, wrapperExitCode, git, workingTree, evidence, fixture, qualificationPreflight }) {
  const summary = {
    status,
    outcome,
    purpose,
    child,
    interruptionSignal,
    wrapperExitCode,
    source: {
      commit: git?.commit ?? null,
      identityStatus: workingTree?.identity?.status ?? 'unknown',
      diffSha256: workingTree?.sourceTestDiffSha256 ?? null,
    },
    evidence,
    ...(fixture ? { fixture } : {}),
    ...(qualificationPreflight ? { qualificationPreflight } : {}),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function summarizeEvidenceError(error, redaction, location) {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeText(message, redaction, location).slice(0, 240);
}

export async function execute(command, args, cwd, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd, env: options.env ?? process.env, stdio: options.diagnosticAuthorization ? ['inherit', 'pipe', 'pipe', 'pipe'] : ['inherit', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
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
      if(options.diagnosticAuthorization){try{child.stdio[3].on('error',()=>{});child.stdio[3].end(JSON.stringify(options.diagnosticAuthorization(child.pid)));}catch(error){launchError=error;sendOwnedSignal('SIGTERM');}}
      if (wrapperSignal && !cleanup.signalSent) cleanup.signalSent = sendOwnedSignal(wrapperSignal);
    });
    child.on('close', (code, signal) => {
      childClosed = true;
      resultOnClose = {
        finishedAt: new Date().toISOString(),
        pid: child.pid ?? null,
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
  if (result.qualificationFailure) return { outcome: 'qualification-failure', basis: 'parent-qualification-contract-not-passed' };
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
  const parsed = parseArguments(argv);
  if (parsed.help) {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  const { options, command, commandArgs } = parsed;
  const localFixture = parsed.localFixture === true;
  const redaction = { count: 0, locations: {}, patterns: options['redact-pattern'] ?? [] };
  const prepared = new Date();
  const id = `${prepared.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const repo = path.resolve(options.repo);
  if (!localFixture) assertDiagnosticLaunchAllowed(repo,{task:options['diagnostic-task'],command,args:commandArgs});
  const evidenceDirectory = path.resolve(options['evidence-dir']);
  const recordPath = path.join(evidenceDirectory, `${id}.json`);
  const stdoutPath = options.summary ? path.join(evidenceDirectory, `${id}.stdout.txt`) : undefined;
  const stderrPath = options.summary ? path.join(evidenceDirectory, `${id}.stderr.txt`) : undefined;
  let localBaseEnvironment;
  if (localFixture) {
    localBaseEnvironment = localFixtureBaseEnvironment({ environment: process.env, evidenceDirectory, attemptId: id });
    const candidateCommit = await gitValue(repo, ['rev-parse', 'HEAD^{commit}'], 'Committed candidate SHA', localBaseEnvironment);
    const candidateTree = await gitValue(repo, ['rev-parse', 'HEAD^{tree}'], 'Committed candidate tree', localBaseEnvironment);
    localBaseEnvironment.CHAIN_NATIVE_CANDIDATE_SHA = candidateCommit;
    localBaseEnvironment.CHAIN_NATIVE_CANDIDATE_TREE = candidateTree;
  }
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
  const sourceEnvironment = localBaseEnvironment ?? process.env;
  const git = await gitIdentity(repo, redaction, sourceEnvironment);
  const workingTree = await collectSourceTestState(repo, redaction, sourceEnvironment);
  // Keep filesystem destinations private to I/O; evidence metadata follows the
  // same redaction policy as source paths and captured child output.
  const evidencePaths = {
    metadataPath: sanitizeText(recordPath, redaction, 'evidence.metadataPath'),
    ...(options.summary ? {
      stdoutPath: sanitizeText(stdoutPath, redaction, 'evidence.stdoutPath'),
      stderrPath: sanitizeText(stderrPath, redaction, 'evidence.stderrPath'),
    } : {}),
  };
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
    ...(options.summary ? { evidence: { status: 'pending', ...evidencePaths } } : {}),
  };

  let localReadiness;
  let localRuntime;
  let effectiveEnvironment = sourceEnvironment;
  const fixturePort = localFixture && localBaseEnvironment.CHAIN_NATIVE_PORT
    ? Number(localBaseEnvironment.CHAIN_NATIVE_PORT) : null;
  try {
    if (localFixture) {
      localReadiness = await validateQualificationReadiness({ repo, evidenceDirectory, environment: localBaseEnvironment, localFixture: true });
      await assertPrivateEvidenceDirectory(localReadiness.evidenceDirectory, 'Recorder evidence destination');
      await assertPrivateEvidenceDirectory(localReadiness.nativeOutputDirectory, 'Local fixture evidence destination');
      await assertLoopbackPortAvailable(fixturePort);
      localRuntime = await createPrivateLocalFixtureRuntime(localReadiness.evidenceDirectory);
      effectiveEnvironment = localFixtureChildEnvironment(localBaseEnvironment, localRuntime);
      record.localFixture = {
        mode: localFixtureId,
        runtime: {
          nodeVersion: process.version,
          nodeExecutable: sanitizeText(process.execPath, redaction, 'localFixture.runtime.nodeExecutable'),
          pathPrepended: sanitizeText(path.dirname(process.execPath), redaction, 'localFixture.runtime.pathPrepended'),
        },
        controlledBoundary: 'External Playwright launch is replaced by the test fixture; no actual browser engine or memory qualification runs.',
        allocation: {
          ownerId: localReadiness.ownership.ownerId,
          leaseSha256: localReadiness.ownership.leaseSha256,
          resource: localReadiness.ownership.resources[0],
          port: fixturePort,
        },
        evidence: {
          nativeOutputDirectory: sanitizeText(localReadiness.nativeOutputDirectory, redaction, 'localFixture.evidence.nativeOutputDirectory'),
        },
        nestedOutcomes: null,
        producer: null,
        cleanup: null,
      };
    } else if (options.qualificationReadiness) {
      localReadiness = await validateQualificationReadiness({ repo, evidenceDirectory, environment: process.env });
    }
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    await writeRecord(recordPath, record);
    record.startedAt = new Date().toISOString();
    record.state = 'running';
    record.execution.outcome = 'running';
    await writeRecord(recordPath, record);
  } catch (error) {
    if (localRuntime) await rm(localRuntime.root, { recursive: true, force: true }).catch(() => {});
    const message = summarizeEvidenceError(error, redaction, 'evidence.prepareError');
    if (!options.summary) throw new Error(message, { cause: error });
    emitSummary({
      status: 'evidence-failure',
      outcome: 'not-started',
      purpose: options.purpose,
      child: { exitCode: null, signal: null },
      wrapperExitCode: evidenceFailureExitCode,
      git,
      workingTree,
      evidence: {
        status: 'failed',
        ...evidencePaths,
        errors: [{ file: 'metadata', message }],
      },
      ...(localFixture ? { fixture: { mode: localFixtureId, status: 'not-started', cleanup: { workload: 'not-launched' } } } : {}),
    });
    process.exitCode = evidenceFailureExitCode;
    return;
  }
  if (!options.summary) process.stderr.write(`record-run: evidence=${evidencePaths.metadataPath}\n`);

  const diagnostic = await admitDiagnosticAttempt(repo, {task:options['diagnostic-task'],request:options['diagnostic-request'],command,args:commandArgs,resultPath:recordPath});
  if(diagnostic?.observed){process.stdout.write(JSON.stringify(diagnostic)+'\n');return;}
  let qualificationPreflight;
  let qualificationEvidenceError;
  let result;
  if (options.qualificationReadiness) {
    try {
      const qualification = await runQualificationPreflight({
        repo,
        evidenceDirectory,
        id,
        requestedBase: options['qualification-base'],
        git,
        redaction,
      });
      qualificationPreflight = qualification.summary;
      record.qualificationPreflight = qualification.summary;
      if (qualification.failed) {
        result = {
          finishedAt: new Date().toISOString(),
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: '',
          requestedChildStarted: false,
          ...(qualification.interruption ? { interruption: qualification.interruption } : { qualificationFailure: true }),
        };
      }
    } catch (error) {
      qualificationEvidenceError = summarizeEvidenceError(error, redaction, 'qualificationPreflight.reportError');
      qualificationPreflight = {
        status: 'failed',
        stage: 'report-write',
        sourceSha: git?.commit ?? null,
        comparisonBase: null,
        selectionStatus: null,
        selectedContractIds: [],
        changedPathCount: null,
        reportPath: null,
      };
      record.qualificationPreflight = qualificationPreflight;
      result = {
        finishedAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        requestedChildStarted: false,
        qualificationFailure: true,
        qualificationEvidenceFailure: true,
      };
    }
    if (!options.summary) {
      const report = qualificationPreflight.reportPath ?? 'unavailable';
      process.stderr.write(`record-run: qualification-preflight=${qualificationPreflight.status} selected=${qualificationPreflight.selectedContractIds.length} report=${report}\n`);
    }
  }
  if (!result) {
    result = await execute(command, commandArgs, repo, { env: effectiveEnvironment });
    result.requestedChildStarted = true;
  }
  const signalNumber = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }[result.interruption?.signal ?? result.signal];
  let wrapperExitCode = result.qualificationEvidenceFailure
    ? evidenceFailureExitCode
    : result.interruption || result.signal
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
  let fixtureSummary;
  if (localFixture) {
    const producer = await readFixtureProducer(localReadiness.nativeOutputDirectory, new Date(record.startedAt));
    const cleanup = await finishLocalFixtureCleanup({
      ownership: localReadiness.ownership,
      childEnvironment: effectiveEnvironment,
      pid: result.pid,
      runtime: localRuntime,
      nativeOutputDirectory: localReadiness.nativeOutputDirectory,
      port: fixturePort,
    });
    if (producer?.artifactPath) producer.artifactPath = sanitizeText(producer.artifactPath, redaction, 'localFixture.producer.artifactPath');
    const safeProducer = sanitizeFixtureValue(producer, redaction, 'localFixture.producer');
    record.localFixture.nestedOutcomes = localFixtureNestedOutcomes(output.stdout, record.execution, fixturePort);
    record.localFixture.producer = safeProducer;
    record.localFixture.workloadOutcome = record.execution.outcome;
    record.localFixture.cleanup = sanitizeFixtureValue(cleanup, redaction, 'localFixture.cleanup');
    const cleanupComplete = cleanup.child.completed && cleanup.listener.status === 'closed'
      && cleanup.allocation.status === 'released' && cleanup.runtimeDirectory.status === 'removed';
    if ((!cleanupComplete || record.localFixture.nestedOutcomes.status !== 'passed') && wrapperExitCode === 0) wrapperExitCode = evidenceFailureExitCode;
    record.execution.wrapperExitCode = wrapperExitCode;
    fixtureSummary = {
      mode: localFixtureId,
      workloadOutcome: record.execution.outcome,
      nestedOutcomes: record.localFixture.nestedOutcomes,
      producer: record.localFixture.producer,
      cleanup: record.localFixture.cleanup,
    };
  }
  record.redaction = { applied: redaction.count > 0, count: redaction.count, locations: { ...redaction.locations } };
  if (options.summary) {
    const evidenceErrors = qualificationEvidenceError ? [{ file: 'qualification-preflight', message: qualificationEvidenceError }] : [];
    for (const [file, filePath, contents] of [
      ['stdout', stdoutPath, output.stdout],
      ['stderr', stderrPath, output.stderr],
    ]) {
      try {
        await writeOutputFile(filePath, contents);
      } catch (error) {
        evidenceErrors.push({ file, message: summarizeEvidenceError(error, redaction, `evidence.${file}Error`) });
      }
    }
    record.evidence = {
      status: evidenceErrors.length ? 'failed' : 'complete',
      ...evidencePaths,
      ...(evidenceErrors.length ? { errors: evidenceErrors } : {}),
    };
    let finalWrapperExitCode = wrapperExitCode;
    if (evidenceErrors.length) finalWrapperExitCode = evidenceFailureExitCode;
    record.execution.wrapperExitCode = finalWrapperExitCode;
    record.redaction = { applied: redaction.count > 0, count: redaction.count, locations: { ...redaction.locations } };
    try {
      await writeRecord(recordPath, record);
    } catch (error) {
      evidenceErrors.push({ file: 'metadata', message: summarizeEvidenceError(error, redaction, 'evidence.metadataError') });
      record.evidence.status = 'failed';
      record.evidence.errors = evidenceErrors;
      if (finalWrapperExitCode === 0) finalWrapperExitCode = evidenceFailureExitCode;
      record.execution.wrapperExitCode = finalWrapperExitCode;
    }
    await finishDiagnosticAttempt(repo,diagnostic);
    emitSummary({
      status: localFixture && wrapperExitCode === evidenceFailureExitCode && result.exitCode === 0
        ? 'evidence-failure' : summaryStatus(result, record.evidence.status),
      outcome: record.execution.outcome,
      purpose: options.purpose,
      child: {
        exitCode: result.requestedChildStarted ? result.exitCode : null,
        signal: result.requestedChildStarted ? result.signal : null,
      },
      interruptionSignal: result.interruption?.signal ?? null,
      wrapperExitCode: finalWrapperExitCode,
      git,
      workingTree,
      evidence: record.evidence,
      ...(fixtureSummary ? { fixture: fixtureSummary } : {}),
      qualificationPreflight,
    });
    process.exitCode = finalWrapperExitCode;
    return;
  }
  await writeRecord(recordPath, record);
  await finishDiagnosticAttempt(repo,diagnostic);
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  process.stderr.write(`record-run: purpose=${options.purpose} outcome=${record.execution.outcome} exit=${wrapperExitCode} childExit=${result.exitCode}\n`);
  process.exitCode = wrapperExitCode;
}

let invokedPath = null;
if (process.argv[1]) {
  try { invokedPath = realpathSync.native(path.resolve(process.argv[1])); } catch {}
}
if (invokedPath && invokedPath === realpathSync.native(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`record-run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
