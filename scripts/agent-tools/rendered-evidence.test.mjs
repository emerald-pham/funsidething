import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureRenderedState, compareRenderedSurfaces, verifyRenderedScreenshotBytes } from './rendered-evidence.mjs';

const command = process.env.RENDERED_EVIDENCE_COMMAND ?? fileURLToPath(new URL('./rendered-evidence.mjs', import.meta.url));
const expectedSurfaces = ['faq-title', 'faq-section', 'faq-question', 'faq-answer', 'faq-list-item', 'faq-paragraph', 'faq-subheading'];

const browserFixture = String.raw`import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(width, height, { blank = false, unsupported = false } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = unsupported ? 3 : 6;
  const rows = Buffer.alloc(height * (1 + width * (unsupported ? 1 : 4)));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    rows[offset++] = 0;
    for (let x = 0; x < width; x += 1) {
      if (unsupported) rows[offset++] = 0;
      else {
        const shade = blank ? 255 : (x + y) % 2 ? 255 : 32;
        rows[offset++] = shade;
        rows[offset++] = shade;
        rows[offset++] = shade;
        rows[offset++] = 255;
      }
    }
  }
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header)];
  if (unsupported) parts.push(chunk('PLTE', Buffer.from([0, 0, 0])));
  parts.push(chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const mode = process.env.RENDERED_EVIDENCE_FAKE_MODE ?? 'normal';
const state = {
  width: 390,
  height: 844,
  innerWidth: 390,
  innerHeight: 844,
  dpr: 1,
  visualScale: 1,
  theme: 'light',
  preferredTheme: 'light',
  input: '',
  tasks: [],
  helpOpen: false,
  expanded: 0,
  screenshotCount: 0,
  expectedTheme: 'light',
  restoreThemeAfterHydration: false,
  captureObservation: null,
  metricTargets: new Map(),
  routeHandler: null,
};

function paint() {
  const effectiveTheme = state.theme === 'system' ? state.preferredTheme : state.theme;
  return effectiveTheme === 'dark'
    ? { background: 'rgb(20, 22, 28)', color: 'rgb(234, 235, 240)', modalBackground: 'rgb(35, 39, 51)' }
    : { background: 'rgb(250, 251, 254)', color: 'rgb(31, 35, 43)', modalBackground: 'rgb(255, 255, 255)' };
}

function observe(surfaces) {
  const colors = paint();
  const baseFontSize = {
    'faq-title': 22.5,
    'faq-section': 15,
    'faq-question': 15,
    'faq-answer': 15,
    'faq-list-item': 15,
    'faq-paragraph': 13.5,
    'faq-subheading': 17.55,
  };
  return {
    viewportCss: { innerWidth: state.innerWidth, innerHeight: state.innerHeight, outerWidth: state.width, outerHeight: state.height },
    devicePixelRatio: state.dpr,
    visualViewport: { width: state.innerWidth / state.visualScale, height: state.innerHeight / state.visualScale, scale: state.visualScale, offsetLeft: 0, offsetTop: 0 },
    theme: { attribute: state.theme === 'system' ? null : state.theme, colorScheme: state.theme === 'system' ? 'light dark' : state.theme, documentBackground: colors.background, documentColor: colors.color, bodyBackground: colors.background, bodyColor: colors.color, modalBackground: colors.modalBackground, modalColor: colors.color },
    documentFontsStatus: 'loaded',
    viewportMeta: 'width=device-width, initial-scale=1',
    surfaces: surfaces.map(({ name, selector }) => ({
      name,
      selector,
      count: name === 'faq-title' ? 1 : 2,
      elements: Array.from({ length: name === 'faq-title' ? 1 : 2 }, (_, index) => ({
        index,
        selectorPath: '#fixture-' + name + '-' + index,
        fontSizePx: state.metricTargets.get(name + ':' + index) ?? baseFontSize[name],
        lineHeightPx: (baseFontSize[name] * 1.5) * ((state.metricTargets.get(name + ':' + index) ?? baseFontSize[name]) / baseFontSize[name]),
        fontFamilyCss: '"Fixture Sans", sans-serif',
        bounds: { x: 10, y: 20 + index * 32, width: 180, height: (baseFontSize[name] * 1.5) * ((state.metricTargets.get(name + ':' + index) ?? baseFontSize[name]) / baseFontSize[name]) },
        documentFontAvailable: true,
      })),
    })),
  };
}

function capturePaint(theme = state.theme) {
  const effectiveTheme = theme === 'system' ? state.preferredTheme : theme;
  const colors = effectiveTheme === 'dark'
    ? { background: 'rgb(20, 22, 28)', color: 'rgb(234, 235, 240)', modalBackground: 'rgb(35, 39, 51)' }
    : { background: 'rgb(250, 251, 254)', color: 'rgb(31, 35, 43)', modalBackground: 'rgb(255, 255, 255)' };
  return {
    theme: {
      attribute: theme === 'system' ? null : theme,
      colorScheme: theme === 'system' ? 'light dark' : theme,
      document: { color: colors.color, backgroundColor: colors.background },
      body: { color: colors.color, backgroundColor: colors.background },
      modal: { color: colors.color, backgroundColor: colors.modalBackground },
    },
    viewport: { width: state.innerWidth, height: state.innerHeight, devicePixelRatio: state.dpr, visualScale: state.visualScale },
    surfaces: [],
  };
}

const page = {
  events: new Map(),
  setDefaultTimeout() {},
  on(name, callback) { this.events.set(name, [...(this.events.get(name) ?? []), callback]); },
  context() { return context; },
  async goto(url) {
    state.width = context.options.viewport.width;
    state.height = context.options.viewport.height;
    state.innerWidth = state.width;
    state.innerHeight = state.height;
    if (mode === 'layout-reference-mismatch') state.innerWidth += 100;
    state.preferredTheme = context.options.colorScheme;
    state.expectedTheme = context.options.colorScheme;
    state.theme = context.options.colorScheme === 'light' ? 'dark' : 'light';
    if (state.routeHandler) {
      let localContinued = false;
      let externalAborted = false;
      await state.routeHandler({ request: () => ({ url: () => url }), continue: async () => { localContinued = true; }, abort: async () => { externalAborted = true; } });
      await state.routeHandler({ request: () => ({ url: () => 'https://external.example/blocked.css' }), continue: async () => { throw new Error('External request was allowed through the fixture.'); }, abort: async () => { externalAborted = true; } });
      if (!localContinued || !externalAborted) throw new Error('The route did not continue local traffic and block external traffic.');
    }
    const body = Buffer.from('<!doctype html><html><head><title>fixture app</title></head><body>isolated fixture</body></html>');
    const request = { resourceType: () => 'document' };
    const response = { request: () => request, url: () => url, status: () => 200, body: async () => body };
    for (const callback of this.events.get('response') ?? []) callback(response);
    if (mode === 'image-response') {
      const imageBody = Buffer.from('synthetic-served-image-v1');
      const imageResponse = {
        request: () => ({ resourceType: () => 'image' }),
        url: () => 'http://127.0.0.1:8999/assets/fixture.png',
        status: () => 200,
        body: async () => imageBody,
      };
      for (const callback of this.events.get('response') ?? []) callback(imageResponse);
    }
      for (const callback of this.events.get('requestfailed') ?? []) callback({
        url: () => 'https://external.example/blocked.css',
        failure: () => ({ errorText: 'net::ERR_FAILED' }),
      });
    return response;
  },
  async waitForSelector() {},
  locator(selector) {
    return {
      count: async () => {
        if (selector === '#modalRoot .mback .modal') return 0;
        if (selector === '#modalRoot #faqsTitle') return state.helpOpen ? 1 : 0;
        if (selector === '#modalRoot details.help-faq:not([open]) > summary') return state.helpOpen ? Math.max(0, 3 - state.expanded) : 0;
        if (selector === 'button[aria-label="FAQs / Changelog"]') return 1;
        return 1;
      },
      isVisible: async () => false,
      async click() {
        if (selector === '#addButton') {
          if (!state.input.trim()) throw new Error('The app Add action received an empty synthetic task.');
          state.tasks.push(state.input);
          if (mode === 'delayed-add') setTimeout(() => { state.input = ''; }, 25);
          else state.input = '';
        } else if (selector === '#themeBtn') {
          if (mode === 'three-state-theme') {
            const choices = ['system', 'light', 'dark'];
            state.theme = choices[(choices.indexOf(state.theme) + 1) % choices.length];
          } else if (mode !== 'theme-mismatch') state.theme = state.theme === 'light' ? 'dark' : 'light';
        } else if (selector === 'button[aria-label="FAQs / Changelog"]') state.helpOpen = true;
        else if (selector === '#modalRoot details.help-faq:not([open]) > summary') state.expanded += 1;
      },
      async fill(value) { state.input = value; },
      async inputValue() { return state.input; },
      async scrollIntoViewIfNeeded() {},
      async innerText() { return selector === '#modalRoot #faqsTitle' ? 'FAQs / Changelog' : 'Quick start'; },
      first() { return this; },
    };
  },
  async evaluate(callback, argument) {
    if (callback.name === 'startCaptureObservation') {
      const initialPaint = capturePaint();
      state.captureObservation = { initialPaint, mutations: [], paintTransitions: [], samples: [], complete: true, frameSamples: 1, samplingPresent: true };
      return { started: true, initialPaint };
    }
    if (callback.name === 'stopCaptureObservation') {
      const observation = state.captureObservation;
      state.captureObservation = null;
      return observation
        ? { ...observation, stable: observation.complete && observation.mutations.length === 0 && observation.paintTransitions.length === 0, overflow: false, durationMs: 18, finalPaint: capturePaint(), observationLimit: 'fixture: fake capture observer' }
        : { complete: false, stable: false, reason: 'fixture observer was not started' };
    }
    if (!Array.isArray(argument)) return true;
    return observe(argument);
  },
  async addStyleTag({ content }) {
    if (state.restoreThemeAfterHydration) {
      state.theme = state.expectedTheme;
      state.restoreThemeAfterHydration = false;
    }
    if (mode === 'layout-capture-mismatch') state.innerHeight += 100;
    if (mode === 'noop-css') return;
    if (mode === 'broken-selector') content = content.replace(/#fixture-/g, '.absent #fixture-');
    if (mode === 'broken-declaration') content = content.replace(/font-size:/g, 'unknown-font-size:');
    // This bounded CSS consumer applies declarations only to fixture elements that selectors match.
    // It deliberately ignores the renderer's diagnostic comments and target annotations.
    const rules = content.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g);
    for (const [, selector, declaration] of rules) {
      const element = selector.trim().match(/^#fixture-(faq-title|faq-section|faq-question|faq-answer|faq-list-item|faq-paragraph|faq-subheading)-(0|1)$/);
      const fontSize = declaration.match(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px\s*!important\s*(?:;|$)/);
      if (!element || !fontSize || (element[1] === 'faq-title' && element[2] !== '0')) continue;
      const [, name, index] = element;
      if (mode === 'partial-css' && name === 'faq-answer' && index === '0') continue;
      state.metricTargets.set(name + ':' + index, mode === 'underscaled-css' ? Number(fontSize[1]) / 1.5 + 0.1 : Number(fontSize[1]));
    }
  },
  async waitForTimeout(ms) {
    if (mode === 'delayed-add') await new Promise((resolve) => setTimeout(resolve, ms));
  },
  keyboard: {
    async press(key) {
      state.lastZoomKey = key;
      if (mode !== 'native-noop') {
        state.dpr *= 1.25;
        state.innerWidth = Math.floor(state.width / state.dpr);
        state.innerHeight = Math.floor(state.height / state.dpr);
      }
    },
  },
  async screenshot() {
    state.screenshotCount += 1;
    if (mode === 'missing-reference' && state.screenshotCount === 1) throw new Error('fixture reference intentionally missing');
    if (mode === 'missing-capture' && state.screenshotCount === 2) throw new Error('fixture capture intentionally missing');
    if (mode === 'viewport-mismatch' && state.screenshotCount === 2) return png(2, 2);
    if (mode === 'theme-flips-and-restores-during-capture' && state.screenshotCount === 1) {
      const before = capturePaint();
      const flippedTheme = state.expectedTheme === 'light' ? 'dark' : 'light';
      state.theme = flippedTheme;
      const flipped = capturePaint();
      state.captureObservation.mutations.push({ type: 'attributes', attributeName: 'data-theme', oldValue: state.expectedTheme, currentValue: flippedTheme, target: 'HTML' });
      state.captureObservation.paintTransitions.push({ sampleIndex: 1, source: 'mutation', before, after: flipped });
      state.theme = state.expectedTheme;
      const restored = capturePaint();
      state.captureObservation.mutations.push({ type: 'attributes', attributeName: 'data-theme', oldValue: flippedTheme, currentValue: state.expectedTheme, target: 'HTML' });
      state.captureObservation.paintTransitions.push({ sampleIndex: 2, source: 'mutation', before: flipped, after: restored });
    }
    const image = png(state.width, state.height, { blank: mode === 'blank', unsupported: mode === 'unsupported-png' });
    if (mode === 'corrupt-png') image[image.length - 1] ^= 0xff;
    return image;
  },
};

const context = {
  options: null,
  async newPage() { return page; },
  async route(_pattern, callback) { state.routeHandler = callback; },
  async newCDPSession() {
    if (mode === 'fonts-unsupported') throw new Error('fixture CDP unavailable');
    return {
      async send(method, parameters = {}) {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelectorAll') return { nodeIds: parameters.selector.includes('faqsTitle') ? [10] : [10, 11] };
        if (method === 'CSS.getPlatformFontsForNode') return { fonts: [{ familyName: 'Fixture Sans', postScriptName: 'FixtureSans-Regular', isCustomFont: false, glyphCount: 48 }] };
        if (method === 'Input.synthesizePinchGesture') {
          if (mode === 'pinch-unsupported') throw new Error('fixture does not support touch gesture injection');
          state.visualScale = parameters.scaleFactor;
          return {};
        }
        return {};
      },
      async detach() {},
    };
  },
  async close() {},
};

export const chromium = {
  async launch() {
    return {
      async newContext(options) { context.options = options; return context; },
      browserType() { return { name: () => 'chromium' }; },
      version() { return 'fixture-chromium-1.0'; },
      async close() {},
    };
  },
};
`;

async function makeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rendered-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimePath = path.join(root, 'playwright-fixture.mjs');
  await writeFile(runtimePath, browserFixture, 'utf8');
  return { root, runtimePath };
}

function run({ root, runtimePath, name, mode = 'normal', theme = 'light', width = 390, height = 844, mechanism = 'diagnostic-css', scale = 1.5 }) {
  const output = path.join(root, name);
  const result = spawnSync(process.execPath, [
    command,
    '--url', 'http://127.0.0.1:8999/',
    '--output', output,
    '--playwright-module', runtimePath,
    '--source-id', 'fixture-source-154',
    '--mechanism', mechanism,
    '--theme', theme,
    '--width', String(width),
    '--height', String(height),
    '--scale', String(scale),
  ], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, RENDERED_EVIDENCE_FAKE_MODE: mode },
  });
  return { result, output };
}

async function readCase(output) {
  return JSON.parse(await readFile(path.join(output, 'case.json'), 'utf8'));
}

test('capture waits for durable native Add acknowledgement before reusing the draft', async (t) => {
  const fixture = await makeFixture(t);
  const { result, output } = run({ ...fixture, name: 'delayed-add', mode: 'delayed-add' });
  assert.equal(result.status, 0, `native Add may clear only after its durable save\n${result.stderr}`);
  const report = await readCase(output);
  assert.equal(report.isolation.syntheticBoard.taskCount, 2);
  assert.equal(report.metricsStatus, 'pass');
  assert.equal(report.captureIntegrity, 'pass');
});

test('theme audit cycles past automatic to verify the explicit opposite paint', async (t) => {
  const fixture = await makeFixture(t);
  for (const theme of ['dark', 'light']) {
    const { result, output } = run({ ...fixture, name: `three-state-${theme}`, mode: 'three-state-theme', theme });
    assert.equal(result.status, 0, `automatic can follow the requested ${theme} paint without being its opposite`);
    const report = await readCase(output);
    assert.equal(report.themePaintAudit.alternate.attribute, theme === 'dark' ? 'light' : 'dark');
    assert.equal(report.themePaintAudit.paintChanged, true);
    assert.equal(report.themePaintAudit.requestedPaintRestored, true);
    assert.equal(report.observed.capture.theme.attribute, theme);
  }
});

test('a reversible theme flip during capture remains visible in bounded mutation and paint evidence', async (t) => {
  const fixture = await makeFixture(t);
  const { result, output } = run({ ...fixture, name: 'transient-theme-flip', mode: 'theme-flips-and-restores-during-capture', theme: 'light' });
  assert.equal(result.status, 1, `a light-labelled capture must fail when a transient dark paint occurs during capture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = await readCase(output);
  assert.equal(report.metricsStatus, 'fail');
  assert.equal(report.captureIntegrity, 'pass');
  assert.equal(report.requested.theme, 'light');
  assert.equal(report.captureAudits.reference.checks.themeStable, false);
  assert.equal(report.captureAudits.reference.checks.themeMatched, false);
  assert.equal(report.captureAudits.reference.observed.afterScreenshot.theme.attribute, 'light', 'the transient flip must already have reverted before the post-capture snapshot');
  assert.equal(report.captureAudits.reference.observed.duringScreenshot.mutations[1].oldValue, 'dark');
  assert.equal(report.captureAudits.reference.observed.duringScreenshot.paintTransitions.length, 2);
});

test('capture stop drains queued theme mutations before disconnecting its observer', async (t) => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await context.newPage();
  t.after(async () => {
    await context.close();
    await browser.close();
  });
  await page.setContent(`<!doctype html><html data-theme="light"><head><style>
    html { color-scheme: light; color: #111; background: #fff; }
    body { color: #111; background: #fff; }
    #modalRoot .modal { color: #111; background: #fff; }
    #target { font: 14px/1.4 sans-serif; }
  </style></head><body><main id="modalRoot"><section class="modal"><p id="target">A stable target surface.</p></section></main></body></html>`);

  const observedPage = {
    context: () => ({ newCDPSession: () => context.newCDPSession(page) }),
    evaluate(callback, argument) {
      if (callback.name === 'stopCaptureObservation') {
        return page.evaluate(() => {
          const root = document.documentElement;
          const expectedTheme = root.getAttribute('data-theme');
          root.setAttribute('data-theme', expectedTheme === 'light' ? 'dark' : 'light');
          root.setAttribute('data-theme', expectedTheme);
          const active = window.__renderedEvidenceCaptureObservation;
          const observation = active.stop();
          delete window.__renderedEvidenceCaptureObservation;
          return observation;
        });
      }
      return page.evaluate(callback, argument);
    },
    async screenshot(options) {
      const bytes = await page.screenshot(options);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true))));
      return bytes;
    },
  };
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'rendered-capture-window-'));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const evidence = await captureRenderedState(observedPage, {
    lifecycleState: 'queued-theme-change-at-stop',
    expectedTheme: 'light',
    expectedViewport: { width: 390, height: 844 },
    baseViewport: { width: 390, height: 844 },
    scale: 1,
    surfaces: [{ name: 'capture-target', selector: '#target', role: 'changed-control', relationship: 'isolated synthetic target' }],
    outputDirectory,
    fileName: 'capture.png',
  });

  assert.equal(evidence.observed.afterScreenshot.theme.attribute, 'light');
  assert.equal(evidence.observed.duringScreenshot.paintTransitions.length, 0, 'the same-task flip does not appear in an animation-frame sample');
  assert.ok(evidence.observed.duringScreenshot.mutations.some((mutation) => mutation.attributeName === 'data-theme' && mutation.oldValue === 'dark'));
  assert.equal(evidence.checks.themeStable, false);
  assert.equal(evidence.metricsStatus, 'fail');
  assert.equal(evidence.captureIntegrity, 'pass');
});

test('a saved screenshot is bound to its actual bytes and a stale image fails the hash check', async (t) => {
  const fixture = await makeFixture(t);
  const { result, output } = run({ ...fixture, name: 'image-hash-binding', mode: 'image-response' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = await readCase(output);
  const screenshotPath = path.join(output, report.screenshots.capture.path);
  const capturedBytes = await readFile(screenshotPath);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(report.screenshots.capture.fileBindingMatches, true);
  assert.equal(report.screenshots.capture.sha256, digest(capturedBytes));
  assert.equal(report.screenshots.capture.savedSha256, digest(capturedBytes));

  const staleBytes = Buffer.from(capturedBytes);
  staleBytes[staleBytes.length - 1] ^= 0xff;
  const staleBinding = verifyRenderedScreenshotBytes(report.screenshots.capture, staleBytes);
  assert.equal(staleBinding.status, 'fail');
  assert.equal(staleBinding.matches, false, 'a stale or changed image cannot retain the capture hash');
  assert.equal(report.artifact.producerFingerprints.rendererModule.sha256.length, 64);
  assert.equal(report.artifact.producerFingerprints.rendererTest.sha256.length, 64);
  assert.equal(report.artifact.producerFingerprints.packageConfig.sha256.length, 64);
  assert.deepEqual(report.artifact.loadedResources.find(({ resourceType }) => resourceType === 'image'), {
    url: 'http://127.0.0.1:8999/assets/fixture.png',
    resourceType: 'image',
    status: 200,
    sha256: digest(Buffer.from('synthetic-served-image-v1')),
    bytes: Buffer.byteLength('synthetic-served-image-v1'),
  });
});

test('no-op CSS enlargement is a real behavioral failure with observed measurements', async (t) => {
  const fixture = await makeFixture(t);
  const { result, output } = run({ ...fixture, name: 'noop-css', mode: 'noop-css' });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, `unchanged FAQ text must fail despite the scale label\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = await readCase(output);
  assert.equal(report.metricsStatus, 'fail');
  assert.equal(report.captureIntegrity, 'pass');
  assert.equal(report.visualStatus, 'unverified');
  assert.equal(report.overallStatus, 'fail');
  assert.equal(report.sourceIdentity, 'fixture-source-154');
  assert.deepEqual(report.browserRuntime, {
    engine: 'chromium',
    version: 'fixture-chromium-1.0',
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    headless: true,
    customExecutable: false,
  });
  assert.equal(report.artifact.documentSha256.length, 64);
  assert.equal(report.observed.reference.theme.attribute, 'light');
  assert.equal(report.observed.reference.theme.modalBackground, 'rgb(255, 255, 255)');
  assert.deepEqual(report.requested.surfaces.map(({ name }) => name), expectedSurfaces);
  assert.equal(report.themePaintAudit.alternateColorSchemeObserved, 'dark');
  assert.equal(report.themePaintAudit.paintChanged, true);
  assert.equal(report.themePaintAudit.requestedPaintRestored, true);
  assert.equal(report.observed.reference.surfaces.length, 7);
  assert.equal(report.observed.resolvedFonts.status, 'captured');
  assert.equal(report.observed.resolvedFonts.bySurface[0].elements[0].fonts[0].familyName, 'Fixture Sans');
  assert.equal(report.isolation.syntheticBoard.taskCount, 2);
  assert.equal(report.observed.documentFontsReady, true);
  assert.equal(report.operations[0].ruleCount, 13);
  assert.equal(report.operations[0].rulesBySurface['faq-title'], 1);
  assert.equal(report.uiActions.help, 'opened through the FAQs / Changelog control');
  assert.deepEqual(report.artifact.loadedResources.map((resource) => resource.resourceType), ['document']);
  assert.deepEqual(report.blockedExternalRequests, ['https://external.example/blocked.css']);
  assert.ok(report.surfaces.every((surface) => surface.metricsStatus === 'fail'));
  assert.ok(report.surfaces.every((surface) => surface.elements.every(({ before, after }) => after.fontSizePx === before.fontSizePx)));
  assert.equal(report.screenshots.reference.width, 390);
  assert.equal(report.screenshots.reference.height, 844);
  assert.deepEqual((await readdir(output)).sort(), ['case.json', 'diagnostic-css-light-390x844-capture.png', 'diagnostic-css-light-390x844-reference.png']);
});

test('correct diagnostic enlargement passes all four theme and narrow/wide cases while visual judgment stays separate', async (t) => {
  const fixture = await makeFixture(t);
  const cases = [
    { theme: 'light', width: 390, height: 844 },
    { theme: 'dark', width: 390, height: 844 },
    { theme: 'light', width: 1280, height: 800 },
    { theme: 'dark', width: 1280, height: 800 },
  ];
  for (const [index, setup] of cases.entries()) {
    const { result, output } = run({ ...fixture, ...setup, name: `css-pass-${index}` });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `correctly scaled ${JSON.stringify(setup)} must pass metrics\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const report = await readCase(output);
    assert.equal(report.metricsStatus, 'pass');
    assert.equal(report.captureIntegrity, 'pass');
    assert.equal(report.visualStatus, 'unverified');
    assert.equal(report.overallStatus, 'unverified');
    assert.ok(report.surfaces.every((surface) => surface.metricsStatus === 'pass'));
    assert.ok(report.surfaces.every((surface) => surface.elements.every(({ before, after }) => after.fontSizePx > before.fontSizePx && after.lineHeightPx > before.lineHeightPx)));
    assert.equal(report.requested.theme, setup.theme);
    assert.equal(report.observed.reference.theme.attribute, setup.theme);
    assert.equal(report.observed.capture.theme.colorScheme, setup.theme);
    assert.equal(report.screenshots.capture.width, setup.width);
    assert.equal(report.screenshots.capture.height, setup.height);
    assert.ok(report.observed.reference.viewportCss.innerWidth === setup.width);
    assert.ok(report.observed.resolvedFontsAfter.bySurface.length === 7);
  }
});

test('a single unaffected FAQ answer element fails the named-surface metric contract', async (t) => {
  const fixture = await makeFixture(t);
  const { result, output } = run({ ...fixture, name: 'partial-css', mode: 'partial-css' });
  assert.equal(result.status, 1);
  const report = await readCase(output);
  assert.equal(report.metricsStatus, 'fail');
  assert.ok(report.surfaces.filter((surface) => surface.name !== 'faq-answer').every((surface) => surface.metricsStatus === 'pass'));
  const answerSurface = report.surfaces.find((surface) => surface.name === 'faq-answer');
  assert.equal(answerSurface.metricsStatus, 'fail');
  assert.equal(answerSurface.elements[0].metricsStatus, 'fail');
  assert.equal(answerSurface.elements[1].metricsStatus, 'pass');
});

test('native page zoom uses the browser keyboard operation and accepts viewport plus device-pixel evidence without CSS font changes', async (t) => {
  const fixture = await makeFixture(t);
  const { result, output } = run({ ...fixture, name: 'native-zoom', mechanism: 'native-page-zoom' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = await readCase(output);
  assert.equal(report.metricsStatus, 'pass');
  assert.equal(report.observed.capture.devicePixelRatio / report.observed.reference.devicePixelRatio, 1.5625);
  assert.ok(report.observed.capture.viewportCss.innerWidth < report.observed.reference.viewportCss.innerWidth);
  assert.ok(report.surfaces.every((surface) => surface.metricsStatus === 'observed-only'));
  assert.ok(report.surfaces.every((surface) => surface.elements.every(({ before, after }) => after.fontSizePx === before.fontSizePx)));
  const zoomOperation = report.operations.find((operation) => operation.type === 'native browser page zoom keyboard shortcut');
  assert.equal(zoomOperation.attemptedSteps, 2);
  assert.equal(zoomOperation.key, process.platform === 'darwin' ? 'Meta+Shift+Equal' : 'Control+Shift+Equal');
  assert.equal(report.visualStatus, 'unverified');
});

test('unsupported native zoom and pinch remain explicitly unverified', async (t) => {
  const fixture = await makeFixture(t);
  const noPageZoom = run({ ...fixture, name: 'native-zoom-unavailable', mode: 'native-noop', mechanism: 'native-page-zoom' });
  assert.equal(noPageZoom.result.status, 2);
  const pageZoomReport = await readCase(noPageZoom.output);
  assert.equal(pageZoomReport.metricsStatus, 'unverified');
  assert.equal(pageZoomReport.captureIntegrity, 'pass');
  assert.equal(pageZoomReport.visualStatus, 'unverified');

  const pinch = run({ ...fixture, name: 'pinch-pass', mechanism: 'pinch-zoom' });
  assert.equal(pinch.result.status, 0, `${pinch.result.stdout}\n${pinch.result.stderr}`);
  const pinchReport = await readCase(pinch.output);
  assert.equal(pinchReport.metricsStatus, 'pass');
  assert.equal(pinchReport.observed.reference.visualViewport.scale, 1);
  assert.equal(pinchReport.observed.capture.visualViewport.scale, 1.5);
  assert.ok(pinchReport.surfaces.every((surface) => surface.metricsStatus === 'observed-only'));

  const unsupportedPinch = run({ ...fixture, name: 'pinch-unavailable', mode: 'pinch-unsupported', mechanism: 'pinch-zoom' });
  assert.equal(unsupportedPinch.result.status, 2);
  const unsupportedReport = await readCase(unsupportedPinch.output);
  assert.equal(unsupportedReport.metricsStatus, 'unverified');
  assert.ok(unsupportedReport.coverageLimits.some((limit) => limit.includes('pinch gesture')));
  assert.equal(unsupportedReport.operations.at(-1).supported, false);
});

test('blank, unsupported, mismatched and missing captures cannot become visual acceptance', async (t) => {
  const fixture = await makeFixture(t);
  const blank = run({ ...fixture, name: 'blank', mode: 'blank' });
  assert.equal(blank.result.status, 1);
  const blankReport = await readCase(blank.output);
  assert.equal(blankReport.metricsStatus, 'pass');
  assert.equal(blankReport.captureIntegrity, 'fail');
  assert.equal(blankReport.visualStatus, 'fail');

  const unsupported = run({ ...fixture, name: 'unsupported-png', mode: 'unsupported-png' });
  assert.equal(unsupported.result.status, 2);
  const unsupportedReport = await readCase(unsupported.output);
  assert.equal(unsupportedReport.metricsStatus, 'pass');
  assert.equal(unsupportedReport.captureIntegrity, 'unverified');
  assert.equal(unsupportedReport.visualStatus, 'unverified');

  const corrupt = run({ ...fixture, name: 'corrupt-png', mode: 'corrupt-png' });
  assert.equal(corrupt.result.status, 1);
  const corruptReport = await readCase(corrupt.output);
  assert.equal(corruptReport.metricsStatus, 'pass');
  assert.equal(corruptReport.captureIntegrity, 'fail');
  assert.match(corruptReport.screenshots.capture.failure, /bad IEND chunk checksum/);

  const mismatch = run({ ...fixture, name: 'viewport-mismatch', mode: 'viewport-mismatch' });
  assert.equal(mismatch.result.status, 1);
  const mismatchReport = await readCase(mismatch.output);
  assert.equal(mismatchReport.captureIntegrity, 'fail');
  assert.equal(mismatchReport.screenshots.capture.width, 2);
  assert.match(mismatchReport.screenshots.capture.failure, /do not match any measured viewport/);

  const missing = run({ ...fixture, name: 'missing-capture', mode: 'missing-capture' });
  assert.equal(missing.result.status, 1);
  const missingReport = await readCase(missing.output);
  assert.equal(missingReport.metricsStatus, 'fail');
  assert.equal(missingReport.captureIntegrity, 'fail');
  assert.equal(missingReport.visualStatus, 'fail');
  assert.ok(missingReport.runtimeErrors.some(({ type }) => type === 'capture'));
  assert.equal(missingReport.screenshots.capture, null);

  const missingReference = run({ ...fixture, name: 'missing-reference', mode: 'missing-reference' });
  assert.equal(missingReference.result.status, 1);
  const missingReferenceReport = await readCase(missingReference.output);
  assert.equal(missingReferenceReport.captureIntegrity, 'fail');
  assert.equal(missingReferenceReport.visualStatus, 'fail');
  assert.equal(missingReferenceReport.screenshots.reference, null);
});

test('theme paint must match and unsupported font resolution is reported as a limit', async (t) => {
  const fixture = await makeFixture(t);
  const mismatch = run({ ...fixture, name: 'theme-mismatch', mode: 'theme-mismatch', theme: 'dark' });
  assert.equal(mismatch.result.status, 1);
  const mismatchReport = await readCase(mismatch.output);
  assert.equal(mismatchReport.metricsStatus, 'fail');
  assert.equal(mismatchReport.observed.reference.theme.attribute, 'light');
  assert.ok(mismatchReport.runtimeErrors.some(({ type }) => type === 'theme-mismatch'));

  const fontsUnavailable = run({ ...fixture, name: 'font-resolution-unavailable', mode: 'fonts-unsupported' });
  assert.equal(fontsUnavailable.result.status, 0);
  const fontReport = await readCase(fontsUnavailable.output);
  assert.equal(fontReport.observed.resolvedFonts.status, 'unavailable');
  assert.ok(fontReport.coverageLimits.some((limit) => limit.includes('Actual platform font names were unavailable')));
});

test('loopback guard and output collision protect evidence scope and prior captures', async (t) => {
  const fixture = await makeFixture(t);
  const unsafe = spawnSync(process.execPath, [
    command,
    '--url', 'https://example.com/',
    '--output', path.join(fixture.root, 'unsafe'),
    '--playwright-module', fixture.runtimePath,
    '--source-id', 'fixture-source-154',
    '--mechanism', 'diagnostic-css',
    '--theme', 'light',
  ], { encoding: 'utf8' });
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /local loopback app/);

  const { result, output } = run({ ...fixture, name: 'collision' });
  assert.equal(result.status, 0);
  const existing = await readFile(path.join(output, 'diagnostic-css-light-390x844-capture.png'));
  const second = spawnSync(process.execPath, [
    command,
    '--url', 'http://127.0.0.1:8999/',
    '--output', output,
    '--playwright-module', fixture.runtimePath,
    '--source-id', 'fixture-source-154',
    '--mechanism', 'diagnostic-css',
    '--theme', 'light',
  ], { encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /Refusing to overwrite existing case evidence/);
  assert.deepEqual(await readFile(path.join(output, 'diagnostic-css-light-390x844-capture.png')), existing);
});


test('standalone capture rejects reference layout mismatch for every mechanism and diagnostic after mismatch', async (t) => {
  const fixture = await makeFixture(t);
  for (const mechanism of ['diagnostic-css', 'native-page-zoom', 'pinch-zoom']) {
    const { result, output } = run({ ...fixture, name: `reference-layout-${mechanism}`, mechanism, mode: 'layout-reference-mismatch' });
    assert.equal(result.status, 1, 'requested and measured reference viewport must agree');
    const report = await readCase(output);
    assert.equal(report.observed.reference.viewportCss.innerWidth, 490);
    assert.equal(report.metricsStatus, 'fail');
    assert.equal(report.overallStatus, 'fail');
  }
  const { result, output } = run({ ...fixture, name: 'capture-layout', mode: 'layout-capture-mismatch' });
  assert.equal(result.status, 1, 'diagnostic CSS must retain the requested layout viewport');
  assert.equal((await readCase(output)).metricsStatus, 'fail');
});


test('CSS consumer rejects broken selectors and declarations even when diagnostic comments retain targets', async (t) => {
  const fixture = await makeFixture(t);
  for (const mode of ['broken-selector', 'broken-declaration']) {
    const { result, output } = run({ ...fixture, name: mode, mode });
    assert.equal(result.status, 1, `${mode}: comments cannot establish CSS effects`);
    const report = await readCase(output);
    assert.equal(report.metricsStatus, 'fail');
    assert.ok(report.surfaces.every(surface => surface.elements.every(({ before, after }) => before.fontSizePx === after.fontSizePx)));
  }
});


test('named diagnostic comparisons require the declared factor for every changed and reference target',()=>{
 const surfaces=[{name:'changed-status',selector:'#status',role:'changed-control'},{name:'settings-reference',selector:'#settings',role:'neighboring-reference-control'}];
 const snapshot=(font,line,height=40,contentHeight=20)=>({surfaces:surfaces.map(surface=>({...surface,count:1,elements:[{fontSizePx:font,lineHeightPx:line,bounds:{height},contentHeightPx:contentHeight}]}))});
 const before=snapshot(16,20),underscale=snapshot(16.1,20.1,40.1,20.1);
 assert.ok(compareRenderedSurfaces(before,underscale,'diagnostic-css',surfaces,1.5).every(row=>row.metricsStatus==='fail'),'16px to 16.1px and 20px to 20.1px cannot qualify declared 1.5x text');
 const enlarged=snapshot(24,30,50,30);assert.ok(compareRenderedSurfaces(before,enlarged,'diagnostic-css',surfaces,1.5).every(row=>row.metricsStatus==='pass'));
 const partial=structuredClone(enlarged);partial.surfaces[1]=underscale.surfaces[1];assert.deepEqual(compareRenderedSurfaces(before,partial,'diagnostic-css',surfaces,1.5).map(row=>row.metricsStatus),['pass','fail']);
 for(const scale of [undefined,null,0,1,NaN,Infinity,'1.5'])assert.ok(compareRenderedSurfaces(before,enlarged,'diagnostic-css',surfaces,scale).every(row=>row.metricsStatus==='fail'),'Absent or invalid declared factors must fail closed');
 const autoBefore=snapshot(16,null,40,20),autoAfter=snapshot(24,null,50,30);assert.ok(compareRenderedSurfaces(autoBefore,autoAfter,'diagnostic-css',surfaces,1.5).every(row=>row.metricsStatus==='pass'),'Fixed 20px padding and border need not enlarge when the measured text content box scales from 20px to 30px');
 for(const mechanism of ['native-page-zoom','pinch-zoom'])assert.ok(compareRenderedSurfaces(before,before,mechanism,surfaces).every(row=>row.metricsStatus==='observed-only'),'Native mechanisms retain viewport-based semantics');
});


test('standalone diagnostic command refuses small positive growth below its declared scale',async t=>{
 const fixture=await makeFixture(t),{result,output}=run({...fixture,name:'underscaled-css',mode:'underscaled-css',scale:1.5});
 assert.equal(result.status,1,'A CLI case labelled 1.5x cannot accept only 0.1px growth');const report=await readCase(output);assert.equal(report.metricsStatus,'fail');assert.equal(report.captureAudits.capture.scale,1.5);assert.ok(report.surfaces.every(surface=>surface.metricsStatus==='fail'));assert.ok(report.surfaces.every(surface=>surface.elements.every(element=>element.declaredScale===1.5)));
});
