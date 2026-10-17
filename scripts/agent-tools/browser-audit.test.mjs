import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const command = fileURLToPath(new URL('./browser-audit.mjs', import.meta.url));
const rendererSourcePath = fileURLToPath(new URL('./rendered-evidence.mjs', import.meta.url));
const fixtureSetupSourcePath = fileURLToPath(new URL('../browser-fixture-setup.mjs', import.meta.url));
const expectedSurfaces = ['faq-title', 'faq-section', 'faq-question', 'faq-answer', 'faq-list-item', 'faq-paragraph', 'faq-subheading'];

const rendererFixture = String.raw`import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
function option(name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
const output = option('--output');
const mechanism = option('--mechanism');
const theme = option('--theme');
const width = Number(option('--width'));
const height = Number(option('--height'));
const scale = Number(option('--scale'));
const sourceIdentity = option('--source-id');
const mode = process.env.BROWSER_AUDIT_FIXTURE_MODE ?? 'normal';
const surfaceNames = ['faq-title', 'faq-section', 'faq-question', 'faq-answer', 'faq-list-item', 'faq-paragraph', 'faq-subheading'];
const report = {
  schemaVersion: 1,
  caseId: mechanism + '-' + theme + '-' + width + 'x' + height,
  sourceIdentity,
  requested: {
    mechanism, theme, viewportCss: { width, height }, scale,
    browserContext: { deviceScaleFactor: 1, hasTouch: mechanism === 'pinch-zoom', isMobile: mechanism === 'pinch-zoom', colorScheme: theme, serviceWorkers: 'block' },
    surfaces: surfaceNames.map((name) => ({ name, selector: '#fixture-' + name })),
  },
  artifact: { documentStatus: 200, documentSha256: 'fixture-document-sha256', loadedResources: [{ resourceType: 'document', sha256: 'fixture-resource-sha256' }] },
  browserRuntime: { engine: 'chromium', version: 'fixture-chromium', nodeVersion: process.version, platform: process.platform, architecture: process.arch, headless: true, customExecutable: true },
  observed: { reference: { viewportCss: { innerWidth: width, innerHeight: height }, theme: { attribute: theme, colorScheme: theme } }, capture: { viewportCss: { innerWidth: width, innerHeight: height }, theme: { attribute: theme, colorScheme: theme } }, resolvedFonts: { status: 'captured', bySurface: surfaceNames.map((name) => ({ name, elements: [{ fonts: [{ familyName: 'Fixture Sans' }] }] })) } },
  screenshots: { reference: { path: 'reference.png', width, height, integrityStatus: 'pass' }, capture: { path: 'capture.png', width, height, integrityStatus: 'pass' } },
  surfaces: surfaceNames.map((name) => ({ name, beforeCount: 1, afterCount: 1, metricsStatus: mechanism === 'diagnostic-css' ? 'pass' : 'observed-only', elements: [{ before: { fontSizePx: 15 }, after: { fontSizePx: 22.5 }, metricsStatus: 'pass' }] })),
  metricsStatus: 'pass', captureIntegrity: 'pass', visualStatus: 'unverified', overallStatus: 'unverified',
  runtimeErrors: [],
  coverageLimits: ['Fixture retains the renderer coverage limit verbatim.'],
};
if (mode === 'screenshot-failure') {
  report.screenshots.capture = null;
  report.captureIntegrity = 'fail';
  report.visualStatus = 'fail';
  report.overallStatus = 'fail';
  report.runtimeErrors.push({ type: 'capture', message: 'Fixture screenshot intentionally failed.' });
  report.coverageLimits.push('Capture failed before a screenshot was available.');
}
if (mode === 'viewport-mismatch') {
  report.observed.reference.viewportCss.innerWidth = 490;
  report.observed.capture.viewportCss.innerWidth = 490;
  report.coverageLimits.push('The renderer measured a 490px viewport despite the requested 390px width.');
}
if (mode === 'wrong-phone-context') {
  report.requested.mechanism = 'pinch-zoom';
  report.requested.browserContext = { deviceScaleFactor: 1, hasTouch: false, isMobile: false, colorScheme: theme, serviceWorkers: 'block' };
}
if (mode === 'missing-surface') {
  report.requested.surfaces = report.requested.surfaces.slice(1);
  report.surfaces = report.surfaces.slice(1);
  report.coverageLimits.push('Fixture removed the FAQ title surface.');
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'case.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(output, 'forwarded-arguments.json'), JSON.stringify(args, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
`;

async function makePortableFixture(t, rendererSource = rendererFixture) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-audit-portable-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts', 'agent-tools');
  await mkdir(scripts, { recursive: true });
  const portableCommand = path.join(scripts, 'browser-audit.mjs');
  await copyFile(command, portableCommand);
  await writeFile(path.join(scripts, 'rendered-evidence.mjs'), rendererSource, 'utf8');
  return { root, command: portableCommand };
}

async function makePortableRealRendererFixture(t) {
  const rendererSource = await readFile(rendererSourcePath, 'utf8');
  const fixture = await makePortableFixture(t, rendererSource);
  await copyFile(fixtureSetupSourcePath, path.join(fixture.root, 'scripts', 'browser-fixture-setup.mjs'));
  return fixture;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitBounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), milliseconds); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('browser audit help names its explicit runtime, resource, source and mode inputs', () => {
  const result = spawnSync(process.execPath, [command, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--source-id <commit-or-artifact-id>/);
  assert.match(result.stdout, /--playwright-module <absolute-module-path>/);
  assert.match(result.stdout, /--resource <kind=allocation-id>/);
  assert.match(result.stdout, /\[--resume\]/);
  assert.match(result.stdout, /desktop-browser\|emulated-phone\|installed-app\|authenticated-production\|physical-device/);
});

test('unsupported device and production modes are retained as distinct untested evidence', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-audit-unsupported-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const expectedLimits = new Map([
    ['installed-app', /Installed-app capture is unsupported/],
    ['authenticated-production', /Authenticated production capture is unsupported/],
    ['physical-device', /Physical device capture is unsupported/],
  ]);

  for (const [mode, coverageLimit] of expectedLimits) {
    const output = path.join(root, mode);
    const result = spawnSync(process.execPath, [
      command,
      '--mode', mode,
      '--source-id', 'fixture-source-158',
      '--output', output,
      '--mechanism', 'diagnostic-css',
      '--theme', 'light',
      '--viewport', '390x844',
    ], { encoding: 'utf8' });

    assert.equal(result.status, 2, `${mode} should be recorded as unverified, not attempted: ${result.stderr}`);
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.requested.mode, mode);
    assert.equal(manifest.runStatus, 'unsupported');
    assert.equal(manifest.cases.length, 1);
    assert.equal(manifest.cases[0].status, 'untested');
    assert.equal(manifest.cases[0].metricsStatus, 'unverified');
    assert.equal(manifest.cases[0].captureIntegrity, 'unverified');
    assert.equal(manifest.cases[0].visualStatus, 'unverified');
    assert.match(manifest.cases[0].coverageLimits.join(' '), coverageLimit);
    assert.equal(manifest.cases[0].attempts.length, 0);
  }
});

test('supported cases delegate through the colocated renderer and retain all seven surface results', async (t) => {
  const fixture = await makePortableFixture(t);
  const unrelatedCheckout = path.join(fixture.root, 'removed-unrelated-checkout');
  await mkdir(unrelatedCheckout);
  await writeFile(path.join(unrelatedCheckout, 'temporary-renderer.mjs'), 'throw new Error("must not be imported");\n');
  await rm(unrelatedCheckout, { recursive: true });

  const output = path.join(fixture.root, 'audit-output');
  const result = spawnSync(process.execPath, [
    fixture.command,
    '--mode', 'desktop-browser',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-158',
    '--output', output,
    '--playwright-module', path.join(fixture.root, 'playwright-fixture.mjs'),
    '--browser-executable', path.join(fixture.root, 'chrome-fixture'),
    '--resource', 'app-server=fixture-server-8999',
    '--resource', 'browser-runtime=fixture-browser-runtime',
    '--mechanism', 'diagnostic-css',
    '--theme', 'dark',
    '--viewport', '390x844',
    '--scale', '1.5',
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.runStatus, 'complete');
  assert.equal(manifest.requested.mode, 'desktop-browser');
  assert.equal(manifest.requested.sourceIdentity, 'fixture-source-158');
  assert.equal(manifest.requested.runtime.playwrightModule, path.join(fixture.root, 'playwright-fixture.mjs'));
  assert.deepEqual(manifest.requested.resources, [
    { kind: 'app-server', id: 'fixture-server-8999' },
    { kind: 'browser-runtime', id: 'fixture-browser-runtime' },
  ]);
  assert.equal(manifest.cases.length, 1);
  const auditCase = manifest.cases[0];
  assert.equal(auditCase.status, 'completed');
  assert.equal(auditCase.modeStatus, 'configured');
  assert.deepEqual(auditCase.browserContext, auditCase.attempts[0].caseReport.requested.browserContext);
  assert.equal(auditCase.browserContext.isMobile, false, 'a narrow desktop viewport must not be represented as a phone-emulation context');
  assert.deepEqual(auditCase.resultStatuses, { metricsStatus: 'pass', captureIntegrity: 'pass', visualStatus: 'unverified', overallStatus: 'unverified' });
  assert.deepEqual(auditCase.coverageLimits, ['Fixture retains the renderer coverage limit verbatim.']);
  const attempt = auditCase.attempts[0];
  assert.equal(attempt.exitCode, 0);
  assert.equal(attempt.status, 'completed');
  assert.ok(Number.isInteger(attempt.rendererProcess.pid) && attempt.rendererProcess.pid > 0, 'manifest should name only its owned renderer child');
  assert.equal(attempt.rendererProcess.processGroupId, process.platform === 'win32' ? null : attempt.rendererProcess.pid);
  assert.equal(attempt.rendererProcess.executable, process.execPath);
  const caseDirectory = path.dirname(path.join(output, attempt.caseReportPath));
  const report = JSON.parse(await readFile(path.join(caseDirectory, 'case.json'), 'utf8'));
  assert.equal(report.sourceIdentity, 'fixture-source-158');
  assert.deepEqual(report.requested.surfaces.map(({ name }) => name), expectedSurfaces);
  assert.deepEqual(report.surfaces.map(({ name }) => name), expectedSurfaces);
  assert.ok(report.surfaces.every(({ metricsStatus }) => metricsStatus === 'pass'));
  assert.equal(report.observed.capture.viewportCss.innerWidth, 390);
  assert.equal(report.observed.capture.theme.attribute, 'dark');
  assert.equal(report.visualStatus, 'unverified');
  const forwarded = JSON.parse(await readFile(path.join(caseDirectory, 'forwarded-arguments.json'), 'utf8'));
  assert.ok(forwarded.includes('--playwright-module'));
  assert.ok(forwarded.includes('--browser-executable'));
  assert.ok(forwarded.includes('fixture-source-158'));
  assert.ok(forwarded.includes('http://127.0.0.1:8999/'));
});

test('portable runner retains rendered-evidence shared fixture dependency after unrelated checkout removal', async (t) => {
  const fixture = await makePortableRealRendererFixture(t);
  const unrelatedCheckout = path.join(fixture.root, 'unrelated-removed-checkout');
  await mkdir(path.join(unrelatedCheckout, 'scripts', 'agent-tools'), { recursive: true });
  await writeFile(path.join(unrelatedCheckout, 'scripts', 'agent-tools', 'rendered-evidence.mjs'), 'throw new Error("removed checkout must not be imported");\n');
  await rm(unrelatedCheckout, { recursive: true });

  const output = path.join(fixture.root, 'portable-real-renderer-output');
  const missingPlaywright = path.join(fixture.root, 'missing-playwright', 'index.mjs');
  const result = spawnSync(process.execPath, [
    fixture.command,
    '--mode', 'desktop-browser',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-portable-real-renderer',
    '--output', output,
    '--playwright-module', missingPlaywright,
    '--resource', 'app-server=fixture-server-8999',
    '--resource', 'browser-runtime=fixture-browser-runtime',
    '--mechanism', 'diagnostic-css',
    '--theme', 'dark',
    '--viewport', '390x844',
  ], { cwd: fixture.root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(await readFile(path.join(fixture.root, 'scripts', 'browser-fixture-setup.mjs'), 'utf8'), await readFile(fixtureSetupSourcePath, 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  const auditCase = manifest.cases[0];
  assert.equal(auditCase.status, 'failed');
  assert.ok(auditCase.caseReportPath, 'the real renderer should have run and written a full case report');
  assert.deepEqual(auditCase.attempts[0].caseReport.requested.surfaces.map(({ name }) => name), expectedSurfaces);
  assert.ok(auditCase.attempts[0].caseReport.runtimeErrors.some(({ type, message }) => type === 'capture' && message.includes(missingPlaywright)));
});

test('screenshot and viewport failures remain failed in the audit manifest', async (t) => {
  const fixture = await makePortableFixture(t);
  for (const mode of ['screenshot-failure', 'viewport-mismatch']) {
    const output = path.join(fixture.root, `audit-${mode}`);
    const result = spawnSync(process.execPath, [
      fixture.command,
      '--mode', 'desktop-browser',
      '--url', 'http://127.0.0.1:8999/',
      '--source-id', 'fixture-source-158',
      '--output', output,
      '--playwright-module', path.join(fixture.root, 'playwright-fixture.mjs'),
      '--resource', 'app-server=fixture-server-8999',
      '--resource', 'browser-runtime=fixture-browser-runtime',
      '--mechanism', 'diagnostic-css',
      '--theme', 'dark',
      '--viewport', '390x844',
    ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, BROWSER_AUDIT_FIXTURE_MODE: mode } });

    assert.equal(result.status, 1, `${mode} must fail capture acceptance: ${result.stdout}\n${result.stderr}`);
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    const auditCase = manifest.cases[0];
    assert.equal(auditCase.status, 'failed');
    const attempt = auditCase.attempts[0];
    const report = JSON.parse(await readFile(path.join(output, attempt.caseReportPath), 'utf8'));
    assert.deepEqual(attempt.caseReport, report);
    if (mode === 'screenshot-failure') {
      assert.deepEqual(auditCase.resultStatuses, { metricsStatus: 'pass', captureIntegrity: 'fail', visualStatus: 'fail', overallStatus: 'fail' });
      assert.equal(report.screenshots.capture, null);
      assert.ok(report.runtimeErrors.some(({ type }) => type === 'capture'));
    } else {
      assert.equal(report.screenshots.capture.width, 390);
      assert.equal(report.observed.reference.viewportCss.innerWidth, 490);
      assert.equal(report.observed.capture.viewportCss.innerWidth, 490);
      assert.deepEqual(auditCase.resultStatuses, { metricsStatus: 'pass', captureIntegrity: 'pass', visualStatus: 'unverified', overallStatus: 'unverified' });
      assert.equal(auditCase.status, 'failed', 'runner must reject renderer metrics when measured innerWidth differs from the requested viewport');
      assert.equal(attempt.status, 'failed');
      const referenceCheck = auditCase.runnerChecks.find(({ name }) => name === 'requested-reference-viewport');
      assert.equal(referenceCheck.status, 'fail');
      assert.equal(referenceCheck.expected.innerWidth, 390);
      assert.equal(referenceCheck.observed.innerWidth, 490);
      assert.deepEqual(auditCase.browserContext, report.requested.browserContext);
    }
  }
});

test('a renderer report missing a contracted FAQ surface fails without discarding its original statuses or report', async (t) => {
  const fixture = await makePortableFixture(t);
  const output = path.join(fixture.root, 'audit-missing-surface');
  const result = spawnSync(process.execPath, [
    fixture.command,
    '--mode', 'desktop-browser',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-158',
    '--output', output,
    '--playwright-module', path.join(fixture.root, 'playwright-fixture.mjs'),
    '--resource', 'app-server=fixture-server-8999',
    '--resource', 'browser-runtime=fixture-browser-runtime',
    '--mechanism', 'diagnostic-css',
    '--theme', 'dark',
    '--viewport', '390x844',
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, BROWSER_AUDIT_FIXTURE_MODE: 'missing-surface' } });

  assert.equal(result.status, 1, `missing contracted surfaces must fail runner validation: ${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  const auditCase = manifest.cases[0];
  assert.equal(auditCase.status, 'failed');
  assert.deepEqual(auditCase.resultStatuses, { metricsStatus: 'pass', captureIntegrity: 'pass', visualStatus: 'unverified', overallStatus: 'unverified' });
  assert.deepEqual(auditCase.attempts[0].caseReport.surfaces.map(({ name }) => name), expectedSurfaces.slice(1));
  assert.deepEqual(auditCase.attempts[0].caseReport.requested.surfaces.map(({ name }) => name), expectedSurfaces.slice(1));
  assert.equal(auditCase.runnerChecks.find(({ name }) => name === 'rendered-evidence-seven-surface-contract').status, 'fail');
  assert.match(auditCase.coverageLimits.join(' '), /must include exactly: faq-title/);
});

test('emulated phone labels require the renderer-reported mobile and touch browser context', async (t) => {
  const fixture = await makePortableFixture(t);
  const output = path.join(fixture.root, 'audit-wrong-phone-context');
  const result = spawnSync(process.execPath, [
    fixture.command,
    '--mode', 'emulated-phone',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-158',
    '--output', output,
    '--playwright-module', path.join(fixture.root, 'playwright-fixture.mjs'),
    '--resource', 'app-server=fixture-server-8999',
    '--resource', 'browser-runtime=fixture-browser-runtime',
    '--mechanism', 'pinch-zoom',
    '--theme', 'dark',
    '--viewport', '390x844',
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, BROWSER_AUDIT_FIXTURE_MODE: 'wrong-phone-context' } });

  assert.equal(result.status, 2, `missing mobile context must remain unverified: ${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  const auditCase = manifest.cases[0];
  assert.equal(auditCase.status, 'completed');
  assert.equal(auditCase.modeStatus, 'unverified');
  assert.deepEqual(auditCase.browserContext, { deviceScaleFactor: 1, hasTouch: false, isMobile: false, colorScheme: 'dark', serviceWorkers: 'block' });
  assert.match(auditCase.coverageLimits.join(' '), /emulated-phone mode requires both hasTouch and isMobile/);
});

test('a configured Chromium phone context stays distinct from physical-device evidence', async (t) => {
  const fixture = await makePortableFixture(t);
  const output = path.join(fixture.root, 'audit-configured-phone-context');
  const result = spawnSync(process.execPath, [
    fixture.command,
    '--mode', 'emulated-phone',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-158',
    '--output', output,
    '--playwright-module', path.join(fixture.root, 'playwright-fixture.mjs'),
    '--resource', 'app-server=fixture-server-8999',
    '--resource', 'browser-runtime=fixture-browser-runtime',
    '--mechanism', 'pinch-zoom',
    '--theme', 'light',
    '--viewport', '390x844',
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  const auditCase = manifest.cases[0];
  assert.equal(auditCase.modeStatus, 'configured');
  assert.deepEqual(auditCase.browserContext, auditCase.attempts[0].caseReport.requested.browserContext);
  assert.equal(auditCase.browserContext.hasTouch, true);
  assert.equal(auditCase.browserContext.isMobile, true);
  assert.match(auditCase.coverageLimits.join(' '), /does not establish physical-device behavior/);
});

test('a missing Playwright runtime is recorded as an attempted renderer failure', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-audit-missing-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'audit-output');
  const missingRuntime = path.join(root, 'missing-playwright', 'index.mjs');
  const result = spawnSync(process.execPath, [
    command,
    '--mode', 'desktop-browser',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-missing-runtime',
    '--output', output,
    '--playwright-module', missingRuntime,
    '--resource', 'app-server=unstarted-fixture-server',
    '--resource', 'browser-runtime=missing-runtime-fixture',
    '--mechanism', 'diagnostic-css',
    '--theme', 'light',
    '--viewport', '390x844',
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  const auditCase = manifest.cases[0];
  assert.equal(manifest.requested.runtime.playwrightModule, missingRuntime);
  assert.equal(auditCase.status, 'failed');
  assert.equal(auditCase.resultStatuses.metricsStatus, 'fail');
  assert.equal(auditCase.resultStatuses.captureIntegrity, 'fail');
  assert.equal(auditCase.resultStatuses.visualStatus, 'fail');
  assert.equal(auditCase.attempts[0].status, 'failed');
  assert.ok(auditCase.attempts[0].caseReport.runtimeErrors.some(({ type }) => type === 'capture'));
  assert.match(auditCase.attempts[0].caseReport.runtimeErrors[0].message, /missing-playwright|Cannot find module/i);
});

test('graceful interruption persists completed work, bounds owned cleanup and preserves another fixture owner', async (t) => {
  const interruptingRenderer = rendererFixture.replace(
    'const report = {',
    `if (process.env.BROWSER_AUDIT_FIXTURE_MODE === 'hang-wide' && width === 1280) {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  child.unref();
  await writeFile(path.join(output, 'descendant.pid'), String(child.pid) + '\\n');
  await new Promise(() => {});
}
const report = {`,
  );
  const fixture = await makePortableFixture(t, interruptingRenderer);
  const output = path.join(fixture.root, 'interrupted-audit');
  const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
  owner.unref();
  let auditProcess;
  let descendantPid = null;
  t.after(async () => {
    if (auditProcess && auditProcess.exitCode === null && auditProcess.signalCode === null) auditProcess.kill('SIGKILL');
    if (descendantPid) { try { process.kill(descendantPid, 'SIGKILL'); } catch {} }
    if (owner.pid) { try { process.kill(owner.pid, 'SIGTERM'); } catch {} }
    await delay(50);
  });

  const args = [
    fixture.command,
    '--mode', 'desktop-browser',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-interruption',
    '--output', output,
    '--playwright-module', path.join(fixture.root, 'playwright-fixture.mjs'),
    '--resource', 'app-server=separate-fixture-owner-' + owner.pid,
    '--resource', 'browser-runtime=fixture-browser-runtime',
    '--mechanism', 'diagnostic-css',
    '--mechanism', 'native-page-zoom',
    '--theme', 'light',
    '--viewport', '390x844',
    '--viewport', '1280x800',
  ];
  auditProcess = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BROWSER_AUDIT_FIXTURE_MODE: 'hang-wide' },
  });
  const closed = new Promise((resolve) => auditProcess.once('close', (code, signal) => resolve({ code, signal })));
  let currentManifest = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      currentManifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
      const currentAttempt = currentManifest.cases[1]?.attempts[0];
      if (currentManifest.cases[0]?.status === 'completed' && currentManifest.cases[1]?.status === 'attempted' && currentAttempt) {
        const pidFile = path.join(output, currentAttempt.caseReportPath.replace(/case\.json$/, 'descendant.pid'));
        try { descendantPid = Number(await readFile(pidFile, 'utf8')); } catch {}
        if (descendantPid) break;
      }
    } catch {}
    await delay(25);
  }

  assert.ok(descendantPid, 'second case should be running with an owned renderer descendant');
  auditProcess.kill('SIGINT');
  const exit = await waitBounded(closed, 5000);
  assert.ok(exit, 'the audit runner should finish bounded cleanup after SIGINT');
  currentManifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(currentManifest.runStatus, 'incomplete');
  assert.equal(currentManifest.cases[0].status, 'completed');
  assert.equal(currentManifest.cases[1].status, 'failed');
  assert.equal(currentManifest.cases[1].attempts[0].failureType, 'interrupted');
  assert.ok(currentManifest.cases.slice(2).every((auditCase) => auditCase.status === 'planned'));
  assert.notEqual(exit.signal, 'SIGINT', 'the runner should finalize its manifest before exiting');
  assert.equal(await processIsAlive(descendantPid), false, 'the runner should stop its owned renderer process tree');
  assert.equal(await processIsAlive(owner.pid), true, 'the separately owned fixture server process must remain alive');
});

test('resume recovers uncatchable termination without inventing case completion or losing prior coverage limits', async (t) => {
  const crashedRenderer = rendererFixture.replace(
    'const report = {',
    `if (process.env.BROWSER_AUDIT_FIXTURE_MODE === 'crash-runner-wide' && width === 1280) {
  await writeFile(path.join(output, 'fixture-renderer.pid'), String(process.pid) + '\\n');
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
const report = {`,
  );
  const fixture = await makePortableFixture(t, crashedRenderer);
  const output = path.join(fixture.root, 'uncatchable-audit');
  const args = [
    fixture.command,
    '--mode', 'desktop-browser',
    '--url', 'http://127.0.0.1:8999/',
    '--source-id', 'fixture-source-uncatchable',
    '--output', output,
    '--playwright-module', path.join(fixture.root, 'playwright-fixture.mjs'),
    '--resource', 'app-server=fixture-server-8999',
    '--resource', 'browser-runtime=fixture-browser-runtime',
    '--mechanism', 'diagnostic-css',
    '--theme', 'dark',
    '--viewport', '390x844',
    '--viewport', '1280x800',
  ];
  const auditProcess = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env: { ...process.env, BROWSER_AUDIT_FIXTURE_MODE: 'crash-runner-wide' } });
  let rendererPid = null;
  t.after(async () => {
    if (auditProcess.exitCode === null && auditProcess.signalCode === null) auditProcess.kill('SIGKILL');
    if (rendererPid) { try { process.kill(rendererPid, 'SIGTERM'); } catch {} }
    await delay(50);
  });

  const closed = new Promise((resolve) => auditProcess.once('close', (code, signal) => resolve({ code, signal })));
  let manifest = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
      const currentAttempt = manifest.cases[1]?.attempts[0];
      if (manifest.cases[0]?.status === 'completed' && manifest.cases[1]?.status === 'attempted' && currentAttempt) {
        try { rendererPid = Number(await readFile(path.join(output, currentAttempt.caseReportPath.replace(/case\.json$/, 'fixture-renderer.pid')), 'utf8')); } catch {}
        if (rendererPid) break;
      }
    } catch {}
    await delay(25);
  }

  assert.ok(rendererPid, `the second case should be running after the first case is durably complete: ${JSON.stringify(manifest?.cases.map(({ status, attempts }) => ({ status, attempts })))}`);
  const completedEvidence = { ...manifest.cases[0], attempts: manifest.cases[0].attempts.map((attempt) => ({ ...attempt })) };
  auditProcess.kill('SIGKILL');
  const forcedExit = await waitBounded(closed, 5000);
  assert.ok(forcedExit, 'the audit runner should terminate immediately for the uncatchable-death fixture');
  assert.equal(forcedExit.signal, 'SIGKILL');
  manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.runStatus, 'running', 'a forced termination must not claim to have run a finalizer');
  assert.equal(manifest.cleanup.status, 'pending', 'an audit with a running renderer must not claim cleanup was unnecessary');
  assert.equal(manifest.cases[0].status, 'completed');
  assert.equal(manifest.cases[1].status, 'attempted');
  assert.equal(manifest.cases[1].attempts[0].status, 'attempted');
  try { process.kill(rendererPid, 'SIGTERM'); } catch {}
  await delay(50);

  const resume = spawnSync(process.execPath, [...args, '--resume'], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.equal(resume.status, 2, `historical cleanup remains unverified: ${resume.stdout}\n${resume.stderr}`);
  manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.runStatus, 'complete');
  assert.equal(manifest.cases[0].attempts.length, 1, 'a durably completed case must not be rerun');
  assert.deepEqual(manifest.cases[0].attempts[0], completedEvidence.attempts[0]);
  const recoveredCase = manifest.cases[1];
  assert.equal(recoveredCase.status, 'completed');
  assert.equal(recoveredCase.attempts.length, 2);
  assert.equal(recoveredCase.attempts[0].status, 'failed');
  assert.equal(recoveredCase.attempts[0].failureType, 'unclean-termination-recovered');
  assert.equal(recoveredCase.attempts[0].cleanup.status, 'unverified');
  assert.equal(manifest.cleanup.status, 'unverified');
  assert.equal(manifest.cleanup.scope, 'all-recorded-attempts');
  assert.deepEqual(manifest.cleanup.unresolvedAttempts.map(({ caseId, attemptNumber, status }) => ({ caseId, attemptNumber, status })), [{ caseId: recoveredCase.id, attemptNumber: 1, status: 'unverified' }]);
  assert.ok(recoveredCase.coverageLimits.some((limit) => /Recovered an attempt without a terminal rendered-evidence report/.test(limit)));
  assert.equal(recoveredCase.attempts[1].status, 'completed');
  assert.deepEqual(recoveredCase.resultStatuses, { metricsStatus: 'pass', captureIntegrity: 'pass', visualStatus: 'unverified', overallStatus: 'unverified' });
  assert.deepEqual(recoveredCase.attempts[1].caseReport.surfaces.map(({ name }) => name), expectedSurfaces);
  assert.deepEqual(manifest.recoveries[0].recoveredAttempts, [{ caseId: recoveredCase.id, attemptNumber: 1 }]);
});

test('handled actual-renderer failure retains earlier completion and marks continued matrix incomplete', async (t) => {
  const fixture = await makePortableRealRendererFixture(t);
  const fixtureSource = await readFile(new URL('./rendered-evidence.test.mjs', import.meta.url), 'utf8');
  const browserSource = fixtureSource.split('const browserFixture = String.raw`')[1].split('\n`;')[0]
    .replace("if (mode === 'missing-capture' && state.screenshotCount === 2)", "if (state.theme === 'dark' && state.screenshotCount === 2)");
  const runtime = path.join(fixture.root, 'playwright.mjs');
  await writeFile(runtime, browserSource);
  const output = path.join(fixture.root, 'partial-failure');
  const result = spawnSync(process.execPath, [fixture.command, '--mode', 'desktop-browser', '--url', 'http://127.0.0.1:8999/', '--resource', 'app-server=synthetic', '--resource', 'browser-runtime=synthetic', '--source-id', 'fixture-mixed', '--output', output, '--playwright-module', runtime, '--mechanism', 'diagnostic-css', '--theme', 'light', '--theme', 'dark', '--viewport', '390x844', '--viewport', '1280x800'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 1, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json')));
  assert.equal(manifest.cases[0].status, 'completed');
  assert.ok(manifest.cases.some(item => item.status === 'failed'));
  assert.ok(manifest.cases.every(item => item.attempts.length === 1), 'handled failures continue the remaining independent matrix cases');
  assert.equal(manifest.runStatus, 'incomplete', 'handled failure must not imply fulfilled coverage');
  assert.ok(manifest.cases.find(item => item.status === 'failed').attempts[0].caseReport.runtimeErrors.some(item => item.type === 'capture'));
});

test('stalled real renderer cannot claim detached browser cleanup and preserves a separate fixture owner', { skip: process.platform === 'win32' }, async (t) => {
  const fixture = await makePortableRealRendererFixture(t);
  const runtime = path.join(fixture.root, 'detached-playwright.mjs');
  const browserPidPath = path.join(fixture.root, 'browser.pid');
  const readyPath = path.join(fixture.root, 'browser.ready');
  const output = path.join(fixture.root, 'stalled-audit');
  const owner = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  owner.unref();
  let auditProcess;
  let browserPid;
  let rendererPid;
  t.after(async () => {
    for (const pid of [browserPid, rendererPid, owner.pid]) if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    if (auditProcess && auditProcess.exitCode === null && auditProcess.signalCode === null) auditProcess.kill('SIGKILL');
    await delay(50);
  });
  const browserCode = `process.on('SIGINT',()=>{}); process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(readyPath)}, 'ready'); setInterval(()=>{},1000);`;
  await writeFile(runtime, `import {spawn} from 'node:child_process'; import {writeFileSync,existsSync} from 'node:fs';
export const chromium = { async launch() {
  process.on('SIGINT',()=>{}); process.on('SIGTERM',()=>{});
  const browser=spawn(process.execPath,['-e',${JSON.stringify(browserCode)}],{detached:true,stdio:'ignore'}); browser.unref();
  writeFileSync(${JSON.stringify(browserPidPath)},String(browser.pid));
  while (!existsSync(${JSON.stringify(readyPath)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120000);
} };`);
  const args = [fixture.command, '--mode', 'desktop-browser', '--url', 'http://127.0.0.1:8999/', '--source-id', 'synthetic-stalled', '--output', output, '--playwright-module', runtime, '--resource', 'app-server=separate-owner', '--resource', 'browser-runtime=synthetic', '--mechanism', 'diagnostic-css', '--theme', 'light', '--viewport', '390x844'];
  auditProcess = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  const closed = new Promise(resolve => auditProcess.once('close', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      browserPid = Number(await readFile(browserPidPath));
      await readFile(readyPath);
      const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json')));
      rendererPid = manifest.cases[0].attempts[0].rendererProcess.pid;
      break;
    } catch { await delay(20); }
  }
  assert.ok(browserPid && rendererPid, 'both synthetic renderer and detached browser must start');
  auditProcess.kill('SIGINT');
  const exit = await waitBounded(closed, 6000);
  assert.ok(exit, 'own group shutdown remains bounded');
  assert.equal(exit.code, 130);
  assert.equal(await processIsAlive(owner.pid), true, 'foreign fixture owner remains alive');
  assert.equal(await processIsAlive(browserPid), true, 'detached browser is outside the group; cleanup must admit uncertainty');
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json')));
  assert.equal(manifest.runStatus, 'incomplete');
  assert.equal(manifest.cleanup.status, 'unverified', 'empty renderer group is not full browser-tree proof');
  const attempt = manifest.cases[0].attempts[0];
  assert.equal(attempt.cleanup.status, 'unverified');
  assert.ok(attempt.cleanup.signalsSent.includes('SIGKILL'));
  assert.equal(attempt.cleanup.processGroupStatus, 'completed');
  assert.match(attempt.coverageLimits.join(' '), /detached browser/i);
});

test('resume retains legacy group-only completion as uncertain without mutating history or signaling its PID', async (t) => {
  const fixture = await makePortableFixture(t);
  const output = path.join(fixture.root, 'legacy-cleanup');
  const args = [fixture.command, '--mode', 'desktop-browser', '--url', 'http://127.0.0.1:8999/', '--source-id', 'legacy-cleanup', '--output', output, '--playwright-module', path.join(fixture.root, 'playwright.mjs'), '--resource', 'app-server=synthetic', '--resource', 'browser-runtime=synthetic', '--mechanism', 'diagnostic-css', '--theme', 'light', '--viewport', '390x844'];
  const initial = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(initial.status, 0, initial.stderr);
  const manifestPath = path.join(output, 'manifest.json');
  const before = JSON.parse(await readFile(manifestPath));
  const owner = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' }); owner.unref();
  t.after(() => { try { process.kill(-owner.pid, 'SIGKILL'); } catch {} });
  const completed = structuredClone(before.cases[0].attempts[0]);
  const legacy = { attemptNumber: 1, status: 'failed', failureType: 'interrupted', signal: 'SIGKILL', rendererProcess: { pid: owner.pid, processGroupId: owner.pid }, cleanup: { status: 'completed', method: 'bounded-owned-process-group-shutdown', signalsSent: ['SIGINT', 'SIGTERM', 'SIGKILL'] } };
  before.cases[0].attempts = [legacy, { ...completed, attemptNumber: 2 }];
  await writeFile(manifestPath, JSON.stringify(before));
  const resume = spawnSync(process.execPath, [...args, '--resume'], { encoding: 'utf8' });
  assert.equal(resume.status, 2, 'legacy empty-group cleanup cannot establish detached-browser termination');
  const after = JSON.parse(await readFile(manifestPath));
  assert.equal(after.cleanup.status, 'unverified');
  assert.deepEqual(after.cases[0].attempts, before.cases[0].attempts, 'history and completed evidence stay exact; no new renderer launches');
  assert.equal(after.cleanup.unresolvedAttempts[0].status, 'unverified');
  assert.match(after.cleanup.unresolvedAttempts[0].reason, /legacy|terminal/i);
  assert.equal(await processIsAlive(owner.pid), true, 'a historical PID does not establish current cleanup ownership');
});
