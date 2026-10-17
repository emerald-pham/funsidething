#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const rendererCommand = fileURLToPath(new URL('./rendered-evidence.mjs', import.meta.url));

const MODES = ['desktop-browser', 'emulated-phone', 'installed-app', 'authenticated-production', 'physical-device'];
const MECHANISMS = ['diagnostic-css', 'native-page-zoom', 'pinch-zoom'];
const THEMES = ['light', 'dark'];
const REQUIRED_SURFACES = ['faq-title', 'faq-section', 'faq-question', 'faq-answer', 'faq-list-item', 'faq-paragraph', 'faq-subheading'];
const UNSUPPORTED_LIMITS = {
  'installed-app': 'Installed-app capture is unsupported by this runner; no app was launched or inspected.',
  'authenticated-production': 'Authenticated production capture is unsupported by this runner; only local unauthenticated apps are supported.',
  'physical-device': 'Physical device capture is unsupported by this runner; an emulated phone does not establish physical-device behavior.',
};
const INTERRUPT_GRACE_MS = 1200;
const TERMINATION_GRACE_MS = 500;

function usage() {
  return `Usage: node scripts/agent-tools/browser-audit.mjs \\
  --mode desktop-browser|emulated-phone|installed-app|authenticated-production|physical-device \\
  --source-id <commit-or-artifact-id> --output <absolute-audit-directory> \\
  --mechanism diagnostic-css|native-page-zoom|pinch-zoom \\
  [--url <local-app-url>] [--playwright-module <absolute-module-path>] \\
  [--browser-executable <absolute-browser-path>] [--resource <kind=allocation-id>] \\
  [--theme light|dark] [--viewport widthxheight] [--scale factor] [--resume]`;
}

function parseArguments(argv) {
  const values = new Map();
  const repeatable = new Set(['mechanism', 'theme', 'viewport', 'resource']);
  const flags = new Set(['resume']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (flags.has(key)) {
      if (values.has(key)) throw new Error(`Option --${key} was provided more than once.`);
      values.set(key, [true]);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (!repeatable.has(key) && values.has(key)) throw new Error(`Option --${key} was provided more than once.`);
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
    index += 1;
  }
  const allowed = new Set(['mode', 'source-id', 'output', 'mechanism', 'url', 'playwright-module', 'browser-executable', 'resource', 'theme', 'viewport', 'scale', 'timeout-ms', 'resume']);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
  return Object.fromEntries([...values].map(([key, entries]) => [key, repeatable.has(key) ? entries : entries[0]]));
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (!match) throw new Error(`Invalid viewport ${value}; expected WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 3840 || height < 320 || height > 3840) {
    throw new Error(`Viewport ${value} must use dimensions from 320 through 3840 CSS pixels.`);
  }
  return { width, height };
}

function parseResource(value) {
  const separator = value.indexOf('=');
  if (separator < 1 || separator === value.length - 1) throw new Error(`Invalid resource ${value}; expected kind=allocation-id.`);
  const kind = value.slice(0, separator).trim();
  const id = value.slice(separator + 1).trim();
  if (!/^[a-z][a-z0-9-]*$/.test(kind) || /[\r\n]/.test(id)) throw new Error(`Invalid resource ${value}; use a lowercase kind and a single-line allocation ID.`);
  return { kind, id };
}

function loopbackUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error('--url must point to a local loopback app without credentials.');
  }
  return url;
}

function parseOptions(values) {
  const mode = values.mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}.`);
  const sourceIdentity = values['source-id']?.trim();
  if (!sourceIdentity || /[\r\n]/.test(sourceIdentity)) throw new Error('--source-id must be a non-empty single-line commit or artifact identity.');
  if (!path.isAbsolute(values.output ?? '')) throw new Error('--output must be an absolute directory path.');
  const mechanisms = values.mechanism ?? [];
  if (!mechanisms.length || mechanisms.some((mechanism) => !MECHANISMS.includes(mechanism))) throw new Error(`--mechanism must be provided and use ${MECHANISMS.join(', ')}.`);
  const themes = values.theme ?? ['light', 'dark'];
  if (themes.some((theme) => !THEMES.includes(theme))) throw new Error('--theme must be light or dark.');
  const viewports = (values.viewport ?? ['390x844', '1280x800']).map(parseViewport);
  const viewportIds = viewports.map(({ width, height }) => `${width}x${height}`);
  if (new Set(viewportIds).size !== viewportIds.length) throw new Error('--viewport values must be unique.');
  if (new Set(themes).size !== themes.length || new Set(mechanisms).size !== mechanisms.length) throw new Error('Repeated themes and mechanisms must be unique.');
  const scale = Number(values.scale ?? 1.5);
  const timeoutMs = Number(values['timeout-ms'] ?? 15000);
  if (!Number.isFinite(scale) || scale <= 1 || scale > 4) throw new Error('--scale must be greater than 1 and no greater than 4.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('--timeout-ms must be an integer from 1000 through 120000.');

  const supported = !Object.hasOwn(UNSUPPORTED_LIMITS, mode);
  const resume = values.resume === true;
  let url = null;
  let playwrightModule = null;
  let browserExecutable = null;
  const resources = (values.resource ?? []).map(parseResource);
  if (supported) {
    if (!values.url) throw new Error('--url is required for desktop-browser and emulated-phone modes.');
    url = loopbackUrl(values.url);
    if (!path.isAbsolute(values['playwright-module'] ?? '')) throw new Error('--playwright-module must be an absolute path for supported browser modes.');
    playwrightModule = path.resolve(values['playwright-module']);
    if (values['browser-executable'] && !path.isAbsolute(values['browser-executable'])) throw new Error('--browser-executable must be an absolute path.');
    browserExecutable = values['browser-executable'] ? path.resolve(values['browser-executable']) : null;
    const resourceKinds = new Set(resources.map(({ kind }) => kind));
    for (const kind of ['app-server', 'browser-runtime']) if (!resourceKinds.has(kind)) throw new Error(`--resource ${kind}=<allocation-id> is required for supported browser modes.`);
    const allowedMechanisms = mode === 'desktop-browser' ? ['diagnostic-css', 'native-page-zoom'] : ['pinch-zoom'];
    const unsupportedMechanism = mechanisms.find((mechanism) => !allowedMechanisms.includes(mechanism));
    if (unsupportedMechanism) throw new Error(`${unsupportedMechanism} is not supported in ${mode} mode.`);
  } else if (resume) {
    throw new Error('--resume is only supported for desktop-browser and emulated-phone audits.');
  }

  return {
    mode,
    sourceIdentity,
    outputDirectory: path.resolve(values.output),
    mechanisms,
    themes,
    viewports,
    scale,
    timeoutMs,
    url,
    playwrightModule,
    browserExecutable,
    resources,
    supported,
    resume,
  };
}

function makeCases(options) {
  const cases = [];
  for (const mechanism of options.mechanisms) {
    for (const theme of options.themes) {
      for (const viewport of options.viewports) {
        const id = `${options.mode}-${mechanism}-${theme}-${viewport.width}x${viewport.height}`;
        const unsupported = UNSUPPORTED_LIMITS[options.mode];
        cases.push({
          id,
          requested: { mode: options.mode, mechanism, theme, viewportCss: viewport, scale: options.scale },
          status: unsupported ? 'untested' : 'planned',
          metricsStatus: 'unverified',
          captureIntegrity: 'unverified',
          visualStatus: 'unverified',
          coverageLimits: unsupported ? [unsupported] : [],
          modeStatus: unsupported ? 'unverified' : 'pending',
          attempts: [],
        });
      }
    }
  }
  return cases;
}

function newManifest(options) {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    auditId: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    runStatus: options.supported ? 'planned' : 'unsupported',
    requested: {
      mode: options.mode,
      sourceIdentity: options.sourceIdentity,
      appUrl: options.url?.href ?? null,
      runtime: {
        nodeExecutable: process.execPath,
        nodeVersion: process.version,
        playwrightModule: options.playwrightModule,
        browserExecutable: options.browserExecutable,
      },
      resources: options.resources,
      matrix: {
        mechanisms: options.mechanisms,
        themes: options.themes,
        viewportsCss: options.viewports,
        scale: options.scale,
      },
    },
    platform: { os: process.platform, architecture: process.arch },
    cases: makeCases(options),
    cleanup: { status: 'not-needed', ownedResources: [] },
    coverageLimits: [
      'The supplied source identity is recorded as declared; the rendered-evidence case separately hashes served document and same-origin resources.',
      'Automated capture integrity does not replace independent visual readability and typography review.',
      'The runner uses only resources named by the caller and does not acquire or release their external leases.',
    ],
  };
}

async function saveManifest(outputDirectory, manifest) {
  manifest.updatedAt = new Date().toISOString();
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const temporaryPath = path.join(outputDirectory, `.manifest-${process.pid}-${randomUUID()}.partial`);
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function createOutput(options) {
  await mkdir(options.outputDirectory, { recursive: true });
  const existing = await readdir(options.outputDirectory);
  if (!options.resume) {
    if (existing.length) throw new Error(`Refusing to use a non-empty audit output directory: ${options.outputDirectory}`);
    return newManifest(options);
  }
  if (!existing.includes('manifest.json')) throw new Error(`Cannot resume without an existing manifest: ${options.outputDirectory}`);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(options.outputDirectory, 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Cannot resume an unreadable audit manifest: ${error?.message ?? error}`);
  }
  const expected = newManifest(options);
  if (manifest.schemaVersion !== 1 || JSON.stringify(manifest.requested) !== JSON.stringify(expected.requested)) {
    throw new Error('--resume inputs must exactly match the versioned audit manifest.');
  }
  const expectedCases = expected.cases.map(({ id, requested }) => ({ id, requested }));
  const recordedCases = Array.isArray(manifest.cases) ? manifest.cases.map(({ id, requested }) => ({ id, requested })) : [];
  if (JSON.stringify(recordedCases) !== JSON.stringify(expectedCases)
    || manifest.cases.some((auditCase) => !Array.isArray(auditCase.attempts))) {
    throw new Error('--resume case matrix does not match the versioned audit manifest.');
  }
  if (!['planned', 'running', 'incomplete', 'complete'].includes(manifest.runStatus)) {
    throw new Error(`Cannot resume an audit manifest in ${String(manifest.runStatus)} state.`);
  }
  manifest.recoveries ??= [];
  const recoveredAttempts = [];
  for (const auditCase of manifest.cases) {
    const attempt = auditCase.attempts.at(-1);
    if (attempt?.status !== 'attempted') continue;
    attempt.status = 'failed';
    attempt.finishedAt = new Date().toISOString();
    attempt.failureType = 'unclean-termination-recovered';
    attempt.failure = 'Recovered an attempt without a terminal rendered-evidence report; no completion or cleanup result was inferred.';
    attempt.coverageLimits = [attempt.failure];
    attempt.cleanup = {
      status: 'unverified',
      method: 'unclean-process-termination-no-safe-ownership-receipt',
      ownedResources: ['renderer child process tree'],
    };
    auditCase.status = 'failed';
    auditCase.resultStatuses ??= { metricsStatus: 'unverified', captureIntegrity: 'unverified', visualStatus: 'unverified', overallStatus: 'unverified' };
    auditCase.coverageLimits = accumulatedCoverageLimits(auditCase);
    recoveredAttempts.push({ caseId: auditCase.id, attemptNumber: attempt.attemptNumber });
  }
  manifest.recoveries.push({
    recoveredAt: new Date().toISOString(),
    previousRunStatus: manifest.runStatus,
    recoveredAttempts,
    limits: ['A forced process termination has no reliable finalizer; outstanding external resource cleanup remains unverified.'],
  });
  manifest.runStatus = 'running';
  manifest.cleanup = {
    status: 'pending',
    ownedResources: ['renderer child process trees'],
    externalResources: 'Caller-supplied app servers and allocation leases remain under their owners.',
  };
  manifest.resumedAt = new Date().toISOString();
  await saveManifest(options.outputDirectory, manifest);
  return manifest;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function portablePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function resultStatuses(report) {
  return {
    metricsStatus: report.metricsStatus,
    captureIntegrity: report.captureIntegrity,
    visualStatus: report.visualStatus,
    overallStatus: report.overallStatus,
  };
}

function accumulatedCoverageLimits(auditCase) {
  const limits = [];
  for (const attempt of auditCase.attempts) {
    const recorded = attempt.coverageLimits ?? (attempt.failure ? [attempt.failure] : []);
    for (const limit of recorded) if (!limits.includes(limit)) limits.push(limit);
  }
  return limits;
}

function reportMatchesCase(report, options, auditCase) {
  const viewport = auditCase.requested.viewportCss;
  return report && report.schemaVersion === 1
    && report.sourceIdentity === options.sourceIdentity
    && report.requested?.mechanism === auditCase.requested.mechanism
    && report.requested?.theme === auditCase.requested.theme
    && report.requested?.viewportCss?.width === viewport.width
    && report.requested?.viewportCss?.height === viewport.height
    && report.requested?.scale === options.scale
    && report.artifact && report.browserRuntime && report.observed
    && Array.isArray(report.requested?.surfaces)
    && Array.isArray(report.surfaces)
    && report.surfaces.every((surface) => surface && typeof surface.name === 'string')
    && ['metricsStatus', 'captureIntegrity', 'visualStatus', 'overallStatus'].every((status) => typeof report[status] === 'string')
    && Array.isArray(report.coverageLimits);
}

function viewportCheck(report, auditCase) {
  const expected = {
    innerWidth: auditCase.requested.viewportCss.width,
    innerHeight: auditCase.requested.viewportCss.height,
  };
  const reference = report.observed?.reference?.viewportCss;
  const referenceObserved = { innerWidth: reference?.innerWidth ?? null, innerHeight: reference?.innerHeight ?? null };
  const checks = [{
    name: 'requested-reference-viewport',
    expected,
    observed: referenceObserved,
    status: referenceObserved.innerWidth === expected.innerWidth && referenceObserved.innerHeight === expected.innerHeight ? 'pass' : 'fail',
    mechanism: 'all mechanisms measure the reference viewport before applying a zoom change',
  }];
  if (auditCase.requested.mechanism === 'diagnostic-css') {
    const capture = report.observed?.capture?.viewportCss;
    const captureObserved = { innerWidth: capture?.innerWidth ?? null, innerHeight: capture?.innerHeight ?? null };
    checks.push({
      name: 'requested-diagnostic-capture-viewport',
      expected,
      observed: captureObserved,
      status: captureObserved.innerWidth === expected.innerWidth && captureObserved.innerHeight === expected.innerHeight ? 'pass' : 'fail',
      mechanism: 'diagnostic-css does not change the browser viewport',
    });
  }
  for (const check of checks) {
    if (check.status === 'fail') check.reason = `${check.name} mismatch: expected ${expected.innerWidth}x${expected.innerHeight}, measured ${check.observed.innerWidth}x${check.observed.innerHeight}.`;
  }
  return checks;
}

function surfaceContractCheck(report) {
  const requested = (report.requested?.surfaces ?? []).map((surface) => surface?.name ?? null);
  const observed = (report.surfaces ?? []).map((surface) => surface?.name ?? null);
  const matches = JSON.stringify(requested) === JSON.stringify(REQUIRED_SURFACES)
    && JSON.stringify(observed) === JSON.stringify(REQUIRED_SURFACES);
  return {
    name: 'rendered-evidence-seven-surface-contract',
    expected: REQUIRED_SURFACES,
    requested,
    observed,
    status: matches ? 'pass' : 'fail',
    reason: matches ? null : `Rendered evidence must include exactly: ${REQUIRED_SURFACES.join(', ')}. Requested: ${requested.join(', ') || '(none)'}. Observed: ${observed.join(', ') || '(none)'}.`,
  };
}

function validateModeContext(report, auditCase) {
  const context = report.requested?.browserContext;
  const emulated = auditCase.requested.mode === 'emulated-phone';
  const required = emulated
    ? { hasTouch: true, isMobile: true }
    : { hasTouch: false, isMobile: false };
  const valid = context && Object.entries(required).every(([key, value]) => context[key] === value)
    && (!emulated || auditCase.requested.mechanism === 'pinch-zoom');
  return {
    status: valid ? 'configured' : 'unverified',
    context: context ?? null,
    source: 'rendered-evidence requested.browserContext configuration',
    required,
    reason: valid && emulated
      ? 'Chromium mobile/touch context is emulated; this does not establish physical-device behavior.'
      : valid ? null : emulated
      ? 'emulated-phone mode requires both hasTouch and isMobile to be true in the renderer context.'
      : 'desktop-browser mode requires both hasTouch and isMobile to be false in the renderer context.',
  };
}

function rendererArguments(options, auditCase, outputDirectory) {
  const { mechanism, theme, viewportCss } = auditCase.requested;
  const args = [
    rendererCommand,
    '--url', options.url.href,
    '--output', outputDirectory,
    '--playwright-module', options.playwrightModule,
    '--source-id', options.sourceIdentity,
    '--mechanism', mechanism,
    '--theme', theme,
    '--width', String(viewportCss.width),
    '--height', String(viewportCss.height),
    '--scale', String(options.scale),
    '--timeout-ms', String(options.timeoutMs),
  ];
  if (options.browserExecutable) args.push('--browser-executable', options.browserExecutable);
  return args;
}

async function executeRenderer(options, attemptDirectory, caseReportPath, auditCase) {
  await mkdir(attemptDirectory, { recursive: false });
  const stdoutPath = path.join(attemptDirectory, 'stdout.log');
  const stderrPath = path.join(attemptDirectory, 'stderr.log');
  const stdoutStream = createWriteStream(stdoutPath, { flags: 'wx' });
  const stderrStream = createWriteStream(stderrPath, { flags: 'wx' });
  const child = spawn(process.execPath, rendererArguments(options, auditCase, attemptDirectory), {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  child.stdout.pipe(stdoutStream);
  child.stderr.pipe(stderrStream);
  let spawnError = null;
  child.on('error', (error) => { spawnError = error; });
  const closed = new Promise((resolve) => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
  let cleanupPromise = null;
  const stop = (signal = 'SIGINT') => {
    cleanupPromise ??= terminateOwnedRendererTree(child, closed, signal);
    return cleanupPromise;
  };
  const rendererProcess = child.pid ? {
    pid: child.pid,
    processGroupId: process.platform === 'win32' ? null : child.pid,
    executable: process.execPath,
    entrypoint: 'rendered-evidence.mjs',
    platform: process.platform,
  } : null;
  try {
    await options.registerActiveStop?.(stop, rendererProcess);
  } catch (error) {
    const cleanup = await stop('SIGTERM');
    if (error && typeof error === 'object') error.rendererCleanup = cleanup;
    throw error;
  }
  const closeResult = await closed;
  await Promise.allSettled([finished(stdoutStream), finished(stderrStream)]);
  const cleanup = cleanupPromise ? await cleanupPromise : await cleanExitedRendererTree(child);
  let report = null;
  let reportError = null;
  try {
    report = JSON.parse(await readFile(caseReportPath, 'utf8'));
  } catch (error) {
    reportError = String(error?.message ?? error).slice(0, 1000);
  }
  const validReport = reportMatchesCase(report, options, auditCase);
  const integrityFailure = validReport && (report.metricsStatus === 'fail' || report.captureIntegrity === 'fail');
  const runnerChecks = validReport ? [...viewportCheck(report, auditCase), surfaceContractCheck(report)] : [];
  const modeValidation = validReport ? validateModeContext(report, auditCase) : { status: 'unverified', context: null, source: 'unavailable', required: null, reason: 'No valid renderer report was available to verify the browser context.' };
  const viewportFailure = runnerChecks.some((check) => check.status === 'fail');
  const processFailure = spawnError || closeResult.exitCode !== 0 && closeResult.exitCode !== 2;
  return {
    exitCode: closeResult.exitCode,
    signal: closeResult.signal,
    spawnError: spawnError ? String(spawnError.message).slice(0, 1000) : null,
    reportError,
    report,
    validReport,
    rendererProcess,
    runnerChecks,
    modeValidation,
    failed: !validReport || integrityFailure || viewportFailure || processFailure,
    stdoutPath,
    stderrPath,
    cleanup,
  };
}

function processGroupExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(-pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function signalOwnedRendererTree(child, signal) {
  if (!child.pid) return false;
  try {
    if (process.platform === 'win32') return child.kill(signal);
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return false;
  }
}

async function waitForClose(closed, milliseconds) {
  return Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), milliseconds))]);
}

async function waitForProcessGroupExit(pid, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline && processGroupExists(pid)) await new Promise((resolve) => setTimeout(resolve, 25));
  return !processGroupExists(pid);
}

async function cleanExitedRendererTree(child) {
  if (process.platform === 'win32' || !child.pid || !processGroupExists(child.pid)) {
    return { status: 'completed', method: process.platform === 'win32' ? 'renderer-closed' : 'owned-process-group-empty', signalsSent: [] };
  }
  const signalsSent = [];
  try { process.kill(-child.pid, 'SIGTERM'); signalsSent.push('SIGTERM'); } catch {}
  if (!(await waitForProcessGroupExit(child.pid, TERMINATION_GRACE_MS))) {
    try { process.kill(-child.pid, 'SIGKILL'); signalsSent.push('SIGKILL'); } catch {}
    await waitForProcessGroupExit(child.pid, TERMINATION_GRACE_MS);
  }
  return {
    status: processGroupExists(child.pid) ? 'incomplete' : 'completed',
    method: 'bounded-owned-process-group-cleanup',
    signalsSent,
  };
}

async function terminateOwnedRendererTree(child, closed, initialSignal) {
  const signalsSent = [];
  if (signalOwnedRendererTree(child, initialSignal)) signalsSent.push(initialSignal);
  let didClose = await waitForClose(closed, INTERRUPT_GRACE_MS);
  if (!didClose && signalOwnedRendererTree(child, 'SIGTERM')) {
    signalsSent.push('SIGTERM');
    didClose = await waitForClose(closed, TERMINATION_GRACE_MS);
  }
  if (!didClose && signalOwnedRendererTree(child, 'SIGKILL')) {
    signalsSent.push('SIGKILL');
    didClose = await waitForClose(closed, TERMINATION_GRACE_MS);
  }
  const descendants = await cleanExitedRendererTree(child);
  return {
    status: didClose && descendants.status === 'completed' ? 'completed' : 'incomplete',
    method: process.platform === 'win32' ? 'bounded-renderer-process-shutdown' : 'bounded-owned-process-group-shutdown',
    signalsSent: [...signalsSent, ...descendants.signalsSent],
  };
}

function finalExitCode(manifest) {
  if (manifest.cases.some((auditCase) => auditCase.status === 'failed')) return 1;
  if (manifest.runStatus === 'incomplete' || manifest.cases.some((auditCase) => auditCase.status === 'untested' || auditCase.status === 'planned' || auditCase.modeStatus === 'unverified' || auditCase.resultStatuses?.metricsStatus === 'unverified' || auditCase.resultStatuses?.captureIntegrity === 'unverified')) return 2;
  return 0;
}

async function runSupported(options) {
  const manifest = await createOutput(options);
  manifest.runStatus = 'running';
  manifest.startedAt ??= new Date().toISOString();
  manifest.cleanup = {
    status: 'pending',
    ownedResources: ['renderer child process trees'],
    externalResources: 'Caller-supplied app servers and allocation leases remain under their owners.',
  };
  await saveManifest(options.outputDirectory, manifest);

  const interruption = { signal: null, stopActive: null };
  const handleInterrupt = (signal) => {
    if (interruption.signal) return;
    interruption.signal = signal;
    if (interruption.stopActive) void interruption.stopActive(signal);
  };
  const onSigint = () => handleInterrupt('SIGINT');
  const onSigterm = () => handleInterrupt('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
  for (const auditCase of manifest.cases) {
    if (interruption.signal) break;
    if (auditCase.status === 'completed' && auditCase.attempts.at(-1)?.status === 'completed') continue;
    const caseDirectory = path.join(options.outputDirectory, 'cases', auditCase.id);
    await mkdir(caseDirectory, { recursive: true });
    const attemptNumber = auditCase.attempts.length + 1;
    const attemptDirectoryName = `attempt-${String(attemptNumber).padStart(3, '0')}`;
    const attemptDirectory = path.join(caseDirectory, attemptDirectoryName);
    const caseReportPath = path.join(attemptDirectory, 'case.json');
    const attempt = {
      attemptNumber,
      status: 'attempted',
      startedAt: new Date().toISOString(),
      caseReportPath: portablePath(path.relative(options.outputDirectory, caseReportPath)),
      stdoutPath: portablePath(path.relative(options.outputDirectory, path.join(attemptDirectory, 'stdout.log'))),
      stderrPath: portablePath(path.relative(options.outputDirectory, path.join(attemptDirectory, 'stderr.log'))),
      cleanup: { status: 'pending', ownedResources: ['renderer child process'] },
    };
    auditCase.status = 'attempted';
    auditCase.attempts.push(attempt);
    await saveManifest(options.outputDirectory, manifest);

    let result;
    try {
      result = await executeRenderer({ ...options, registerActiveStop: async (stop, rendererProcess) => {
        interruption.stopActive = stop;
        attempt.rendererProcess = rendererProcess;
        await saveManifest(options.outputDirectory, manifest);
        if (interruption.signal) void stop(interruption.signal);
      } }, attemptDirectory, caseReportPath, auditCase);
    } catch (error) {
      result = { failed: true, spawnError: String(error?.message ?? error).slice(0, 1000), exitCode: null, signal: null, report: null, reportError: null, rendererProcess: attempt.rendererProcess ?? null, cleanup: error?.rendererCleanup ?? { status: 'incomplete', method: 'renderer-launch-failed', signalsSent: [] } };
    }
    interruption.stopActive = null;
    attempt.finishedAt = new Date().toISOString();
    attempt.exitCode = result.exitCode;
    attempt.signal = result.signal;
    attempt.rendererProcess = result.rendererProcess ?? attempt.rendererProcess ?? null;
    attempt.status = result.failed ? 'failed' : 'completed';
    attempt.cleanup = {
      ...result.cleanup,
      ownedResources: result.rendererProcess
        ? [`renderer child pid ${result.rendererProcess.pid}`, ...(result.rendererProcess.processGroupId ? [`renderer process group ${result.rendererProcess.processGroupId}`] : [])]
        : ['renderer child process tree'],
      rendererReportedErrors: result.report?.runtimeErrors?.filter((error) => error.type === 'cleanup') ?? [],
    };
    if (result.spawnError) attempt.failure = result.spawnError;
    if (result.reportError) attempt.failure = `Could not read a valid rendered-evidence case: ${result.reportError}`;
    if (result.report && result.validReport) {
      const bytes = await readFile(caseReportPath);
      attempt.caseReportSha256 = sha256(bytes);
      attempt.caseReport = result.report;
      attempt.resultStatuses = resultStatuses(result.report);
      attempt.coverageLimits = [...result.report.coverageLimits];
      attempt.artifact = result.report.artifact;
      attempt.browserRuntime = result.report.browserRuntime;
      attempt.runnerChecks = result.runnerChecks;
      attempt.modeStatus = result.modeValidation.status;
      attempt.browserContext = result.modeValidation.context;
      attempt.browserContextSource = result.modeValidation.source;
      auditCase.resultStatuses = resultStatuses(result.report);
      auditCase.runnerChecks = result.runnerChecks;
      auditCase.modeStatus = result.modeValidation.status;
      auditCase.browserContext = result.modeValidation.context;
      auditCase.browserContextSource = result.modeValidation.source;
      if (result.modeValidation.reason && !attempt.coverageLimits.includes(result.modeValidation.reason)) {
        attempt.coverageLimits.push(result.modeValidation.reason);
      }
      for (const check of result.runnerChecks.filter(({ status }) => status === 'fail')) {
        attempt.coverageLimits.push(check.reason);
      }
      auditCase.coverageLimits = accumulatedCoverageLimits(auditCase);
      if (result.runnerChecks.some(({ status }) => status === 'fail')) {
        attempt.failureType = 'runner-validation';
        attempt.failure = 'Runner validation checks failed; the full renderer report is retained without changing its statuses.';
      }
      auditCase.caseReportPath = attempt.caseReportPath;
    } else {
      attempt.failure ??= 'The renderer exited without a valid schema-versioned case report.';
      if (interruption.signal) {
        attempt.failureType = 'interrupted';
        attempt.interruptionSignal = interruption.signal;
        attempt.failure = `The runner received ${interruption.signal} before a terminal rendered-evidence case report was available.`;
      }
      auditCase.resultStatuses = { metricsStatus: 'unverified', captureIntegrity: 'unverified', visualStatus: 'unverified', overallStatus: 'unverified' };
      auditCase.coverageLimits = [attempt.failure];
      attempt.coverageLimits = [attempt.failure];
      auditCase.modeStatus = 'unverified';
      auditCase.browserContext = null;
      auditCase.browserContextSource = 'unavailable';
      auditCase.runnerChecks = [];
      attempt.runnerChecks = [];
      attempt.modeStatus = 'unverified';
    }
    auditCase.status = attempt.status === 'failed' ? 'failed' : 'completed';
    await saveManifest(options.outputDirectory, manifest);
    if (interruption.signal) break;
  }

  manifest.runStatus = interruption.signal ? 'incomplete' : 'complete';
  if (interruption.signal) {
    manifest.interruptedAt = new Date().toISOString();
    manifest.interruptionSignal = interruption.signal;
  } else manifest.completedAt = new Date().toISOString();
  manifest.cleanup = {
    status: manifest.cases.filter((auditCase) => auditCase.attempts.length).every((auditCase) => auditCase.attempts.at(-1)?.cleanup?.status === 'completed') ? 'completed' : 'incomplete',
    ownedResources: ['renderer child process trees'],
    externalResources: 'Caller-supplied app servers and allocation leases remain under their owners.',
  };
  await saveManifest(options.outputDirectory, manifest);
  process.stdout.write(`${JSON.stringify({ runStatus: manifest.runStatus, manifest: path.join(options.outputDirectory, 'manifest.json'), cases: manifest.cases.map(({ id, status, resultStatuses }) => ({ id, status, resultStatuses })) })}\n`);
  return interruption.signal === 'SIGINT' ? 130 : interruption.signal === 'SIGTERM' ? 143 : finalExitCode(manifest);
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

async function recordUnsupported(options) {
  await createOutput(options);
  const manifest = newManifest(options);
  manifest.completedAt = new Date().toISOString();
  await saveManifest(options.outputDirectory, manifest);
  process.stdout.write(`${JSON.stringify({ runStatus: manifest.runStatus, manifest: path.join(options.outputDirectory, 'manifest.json'), cases: manifest.cases.map(({ id, status, coverageLimits }) => ({ id, status, coverageLimits })) })}\n`);
  return 2;
}

async function main() {
  const rawOptions = parseArguments(process.argv.slice(2));
  if (rawOptions.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const options = parseOptions(rawOptions);
  if (!options.supported) return recordUnsupported(options);
  return runSupported(options);
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
