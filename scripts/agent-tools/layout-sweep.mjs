#!/usr/bin/env node
// Layout sweep (#2480): serves a base build and a candidate build of the
// scanner and reports every width where a listed row takes more lines on the
// candidate than on the base. In #2460 every blocking layout finding came from
// a reviewer's own one-off sweep script; this is that sweep as one command.
//
//   npm run agent:layout-sweep -- --base <ref> --selector <rows> [--selector <rows>...]
//
// See docs/agents/rendered-evidence.md#layout-sweep for options and limits.
// The steady-scanner browser tests in tests/core.test.js reuse the page
// helpers below, so the tests and the command measure lines and enlarge text
// the same way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { servedShellReader } from '../shell-fingerprints.mjs';

export const PHONE_WIDTHS = Array.from({ length: 161 }, (_, i) => 320 + i);
export const PHONE_HEIGHT = 812;
export const WIDE_VIEWS = [{ name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1280, height: 900 }];
export const TEXT_SCALES = { '100%': 1, '150%': 1.5, '200%': 2 };
export const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const STEADY_FILLER = 'ask for the quote again and compare the two replies before deciding what to keep ';

const USAGE = `Usage: npm run agent:layout-sweep -- --base <ref> --selector <css> [--selector <css>...]
  [--candidate <ref>] [--repo <dir>] [--playwright-module <path>] [--output <file.json>]
  [--engines chromium,webkit] [--fonts web,blocked] [--postpone on,off]
  [--text 100%,150%,200%,minimum] [--minimum-font-size 16] [--channel chromium]`;

export function parseArgs(argv) {
  const options = { base: null, candidate: 'WORKTREE', repo: process.cwd(), selectors: [], playwrightModule: null, output: null,
    engines: ['chromium', 'webkit'], fonts: ['web', 'blocked'], postpone: ['on', 'off'], text: ['100%', '150%', '200%', 'minimum'],
    minimumFontSize: 16, channel: 'chromium' };
  const list = (value, allowed, name) => {
    const items = value.split(',').map(s => s.trim()).filter(Boolean);
    const unknown = items.filter(item => !allowed.includes(item));
    if (!items.length || unknown.length) throw new Error(`${name} takes ${allowed.join(', ')}; got ${value}`);
    return items;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = argv[i + 1];
    const need = () => { if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`); i++; return value; };
    if (flag === '--base') options.base = need();
    else if (flag === '--candidate') options.candidate = need();
    else if (flag === '--repo') options.repo = path.resolve(need());
    else if (flag === '--selector') options.selectors.push(need());
    else if (flag === '--playwright-module') options.playwrightModule = path.resolve(need());
    else if (flag === '--output') options.output = path.resolve(need());
    else if (flag === '--engines') options.engines = list(need(), ['chromium', 'webkit'], flag);
    else if (flag === '--fonts') options.fonts = list(need(), ['web', 'blocked'], flag);
    else if (flag === '--postpone') options.postpone = list(need(), ['on', 'off'], flag);
    else if (flag === '--text') options.text = list(need(), [...Object.keys(TEXT_SCALES), 'minimum'], flag);
    else if (flag === '--minimum-font-size') {
      options.minimumFontSize = Number(need());
      if (!Number.isInteger(options.minimumFontSize) || options.minimumFontSize < 6 || options.minimumFontSize > 48) throw new Error('--minimum-font-size takes a whole number of px from 6 to 48');
    } else if (flag === '--channel') options.channel = need();
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown option ${flag}\n${USAGE}`);
  }
  if (options.help) return options;
  if (!options.base) throw new Error(`--base is required\n${USAGE}`);
  if (!options.selectors.length) throw new Error(`at least one --selector is required\n${USAGE}`);
  return options;
}

// A build is a Git commit or the working tree. Each is served the way the
// Pages deploy serves it: index.html and sw.js stamped from the served files.
export function buildReader(repo, ref) {
  if (ref === 'WORKTREE') return { ref, sha: null, read: name => fs.readFileSync(path.join(repo, name)) };
  const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim();
  const cache = new Map();
  const read = name => {
    if (!cache.has(name)) cache.set(name, execFileSync('git', ['show', `${sha}:${name}`], { cwd: repo, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));
    return cache.get(name);
  };
  return { ref, sha, read };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

export async function serveBuild(repo, ref) {
  const build = buildReader(repo, ref);
  let served;
  try { served = servedShellReader(build.read); served('index.html'); }
  catch { served = build.read; } // a build from before #2380 already carries its identities
  const server = http.createServer((request, response) => {
    let name;
    try { name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch { response.writeHead(400); response.end(); return; }
    if (name.split('/').includes('..')) { response.writeHead(403); response.end(); return; }
    let bytes = null;
    try { bytes = served(name); } catch { /* missing: 404 */ }
    response.writeHead(bytes ? 200 : 404, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(bytes || 'Not found');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref(); // a test that stops early never holds the process open
  const page = served('index.html').toString();
  return { ref, sha: build.sha, url: `http://127.0.0.1:${server.address().port}/`,
    fingerprint: page.match(/<template id="appChangelogCurrent"><div data-app-fingerprint="([^"]*)"/)?.[1] ?? null,
    close: () => new Promise(resolve => server.close(resolve)) };
}

// The steady scanner's seeded board: a dotted task, a long-titled overdue
// candidate and titles from a few words to a paragraph, as in tests/core.test.js.
export function steadyBoard({ postpone = false, tasks = 8 } = {}) {
  return JSON.stringify({
    v: 1, contexts: [], considered: {}, cantAt: {}, workedAt: {}, workLog: [], interventionActive: false, interventionP: 0, snooze: 0,
    mode: 'scan', decisionsMs: [], presentedAt: 0, passStartedAt: 0, listOpen: false, ctxOpen: true, histOpen: false, seenQuickStart: true, updatedAt: 0,
    tasks: Array.from({ length: tasks }, (_, i) => ({ id: 'steady-' + i, title: 'Steady task ' + i + ' ' + STEADY_FILLER.repeat([0, 0, 1, 3, 0, 6, 1][i % 7]),
      url: null, due: i === 2 ? '2026-01-02' : null, evergreen: false, ctx: [], mu: 25, sigma: 25 / 3, done: false, createdAt: 1790000000000 + i, completedAt: null, lastDoneAt: null })),
    chain: ['steady-0', 'steady-1'], candidateId: 'steady-2',
    settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, workedHours: 8, theme: 'system', showPostpone: postpone, floatingHeader: false },
  });
}

// Everything that runs in the page goes through this one function, chosen by
// `op`, so the tests and the command share it.
export function pageOp(arg) {
  if (arg.op === 'ready') return document.documentElement.dataset.appReady === 'true' && !document.querySelector('dialog[open]') && arg.selectors.every(s => document.querySelector(s));
  if (arg.op === 'fonts') return [...document.fonts].filter(face => face.status === 'loaded').length;
  if (arg.op === 'settle') return document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
  if (arg.op === 'minimum') {
    // A 1 px probe computes at the browser's minimum font size when one applies.
    const probe = document.createElement('span');probe.style.fontSize = '1px';probe.textContent = 'x';document.body.append(probe);
    const size = parseFloat(getComputedStyle(probe).fontSize);probe.remove();return size;
  }
  if (arg.op === 'scale') {
    // A platform text scale multiplies every font size, a child's own px size
    // (a key hint's, say) and generated content included, not just the
    // buttons'. Each size is read with the scale switched off and set by the
    // element's classes and its parents', so an element added later with a
    // known shape (a new Yes-style choice, a re-rendered row) is scaled the
    // moment it is inserted. Unseen shapes are added whenever the scanner
    // re-renders or changes a class.
    const root = document.querySelector(arg.root);
    if (!root) throw new Error(`text scale: ${arg.root} is not on the page`);
    const style = document.createElement('style');style.id = 'layout-text-scale';document.head.append(style);
    const shape = el => el.localName + [...el.classList].map(name => '.' + CSS.escape(name)).join('');
    // The element's shape under its nearest `depth` ancestors inside the root.
    const keyAt = (el, depth) => {
      const parts = [shape(el)];
      let node = el.parentElement;
      for (let d = 0; node && node !== root && d < depth; d++, node = node.parentElement) parts.unshift(shape(node));
      return arg.root + (node === root ? ' > ' : ' ') + parts.join(' > ');
    };
    const sizes = new Map();
    const apply = () => {
      style.disabled = true;
      const seen = [];
      for (const el of root.querySelectorAll('*')) for (const pseudo of ['', '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo || null);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        seen.push({ el, pseudo, size: parseFloat(cs.fontSize) * arg.scale });
      }
      // A shape shared by elements of different sizes takes its ancestors
      // until each key has one size.
      for (let depth = 1, pending = seen; pending.length && depth <= 12; depth++) {
        const groups = new Map();
        for (const item of pending) { const key = keyAt(item.el, depth) + item.pseudo; (groups.get(key) || groups.set(key, []).get(key)).push(item); }
        pending = [];
        for (const [key, items] of groups) {
          if (depth < 12 && new Set(items.map(i => i.size)).size > 1) pending.push(...items);
          else sizes.set(key, items.at(-1).size);
        }
      }
      sizes.set(arg.root, parseFloat(getComputedStyle(root).fontSize) * arg.scale);
      style.textContent = [...sizes].map(([key, size]) => `${key}{font-size:${size}px!important}`).join('\n');
      style.disabled = false;
      return sizes.size;
    };
    new MutationObserver(apply).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return apply();
  }
  if (arg.op === 'lines') {
    // A row's lines are its rendered children grouped top to bottom: a child
    // starts a new line when it begins below the bottom of the line so far.
    const lines = row => {
      const boxes = [...row.children].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      let count = 0, bottom = -Infinity;
      for (const box of boxes) { if (box.top >= bottom - 1) { count++; bottom = box.bottom; } else bottom = Math.max(bottom, box.bottom); }
      return count;
    };
    return Object.fromEntries(arg.selectors.map(selector => [selector, [...document.querySelectorAll(selector)].map(lines)]));
  }
  throw new Error('unknown page op ' + arg.op);
}

export async function scaleText(page, scale, root = '#scan') {
  if (scale === 1) return 0;
  const rules = await page.evaluate(pageOp, { op: 'scale', scale, root });
  if (!rules) throw new Error(`text scale ${scale}: nothing under ${root} to scale`);
  await page.evaluate(pageOp, { op: 'settle' });
  return rules;
}

// Chrome's own minimum font size, which raises small text but not the em
// lengths sized from it. Only a full Chromium reads it from the profile (the
// headless shell ignores it), so each context gets a fresh profile, and the
// setting is checked on a probe before the context is handed back.
export function chromeMinimumFontHost(chromium, minimum, { channel = 'chromium' } = {}) {
  return {
    async newContext(options) {
      const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chrome-minimum-font-'));
      fs.mkdirSync(path.join(profile, 'Default'));
      fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { minimum_font_size: minimum, minimum_logical_font_size: minimum } } }));
      const context = await chromium.launchPersistentContext(profile, { ...options, headless: true, channel });
      // The profile goes once Chrome has let go of it, before close() returns.
      const close = context.close.bind(context);
      context.close = async (...args) => { try { await close(...args); } finally { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } };
      const probe = await context.newPage();
      try {
        await probe.setContent('<!doctype html><body></body>');
        const size = await probe.evaluate(pageOp, { op: 'minimum' });
        if (size !== minimum) throw new Error(`Chrome's minimum font size did not take effect: a 1 px probe computes at ${size} px, not ${minimum} px`);
      } catch (error) { await context.close(); throw error; } finally { if (!probe.isClosed()) await probe.close(); }
      return context;
    },
  };
}

// Opens a served build on the seeded board in a fresh context: service workers
// blocked, every outside host blocked except the Google Fonts hosts when web
// fonts are wanted, and the fonts checked to be loaded or blocked as asked.
export async function openBoardPage(host, { url, fingerprint = null, board, fonts, width, height, touch, isMobile = touch, selectors, scale = 1, dpr = 2 }) {
  const origin = new URL(url).origin;
  const context = await host.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      return target.origin === origin || (fonts === 'web' && FONT_HOSTS.includes(target.hostname)) ? route.continue() : route.abort();
    });
    await context.addInitScript(({ board, fingerprint }) => {
      Object.defineProperty(window, 'FIREBASE_CONFIG', { value: Object.freeze({}), writable: false, configurable: false });
      localStorage.setItem('fvp:chain-scanner:landscape-motion', JSON.stringify({ choice: 'reduced', savedAt: Date.now() }));
      if (fingerprint) localStorage.setItem('fvp:chain-scanner:last-notified-release', fingerprint);
      if (localStorage.getItem('fvp:chain-scanner:v1') === null) localStorage.setItem('fvp:chain-scanner:v1', board);
    }, { board, fingerprint });
    const page = context.pages()[0] ?? await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(pageOp, { op: 'ready', selectors }, { timeout: 60000 });
    await page.evaluate(pageOp, { op: 'settle' });
    const loaded = await page.evaluate(pageOp, { op: 'fonts' });
    if (fonts === 'web' && !loaded) throw new Error('positive control: no web font loaded, which needs the Google Fonts hosts');
    if (fonts === 'blocked' && loaded) throw new Error(`positive control: ${loaded} web fonts loaded while blocked`);
    await scaleText(page, scale);
    return { context, page, errors };
  } catch (error) { await context.close(); throw error; }
}

// Lines per listed row at each width, read by resizing one page.
export async function sweepLines(page, selectors, views) {
  const out = {};
  for (const { width, height } of views) {
    await page.setViewportSize({ width, height });
    await page.evaluate(pageOp, { op: 'settle' });
    out[width] = await page.evaluate(pageOp, { op: 'lines', selectors });
  }
  return out;
}

// Every width and row where the candidate takes more lines than the base, or
// lacks a row the base shows.
export function moreLinesThanBase(base, candidate) {
  const found = [];
  for (const width of Object.keys(base).map(Number).sort((a, b) => a - b)) {
    for (const [selector, baseRows] of Object.entries(base[width])) {
      const candidateRows = candidate[width]?.[selector] ?? [];
      baseRows.forEach((lines, index) => {
        const now = candidateRows[index];
        if (now === undefined) found.push({ width, selector, index, base: lines, candidate: null });
        else if (now > lines) found.push({ width, selector, index, base: lines, candidate: now });
      });
    }
  }
  return found;
}

export function describeFinding(caseLabel, finding) {
  const row = finding.index ? `${finding.selector} #${finding.index + 1}` : finding.selector;
  return finding.candidate === null
    ? `${caseLabel} ${finding.width}px ${row}: missing on the candidate (base ${finding.base} lines)`
    : `${caseLabel} ${finding.width}px ${row}: ${finding.base} -> ${finding.candidate} lines`;
}

// One case: the same board, fonts, text size and views on the base and the
// candidate, each in a fresh context. A build is { url, fingerprint }.
export async function compareCase(host, builds, { board, fonts, views, touch, isMobile = touch, selectors, scale = 1, label = '' }) {
  const lines = {};
  for (const [name, build] of Object.entries(builds)) {
    const opened = await openBoardPage(host, { url: build.url, fingerprint: build.fingerprint, board, fonts,
      width: views[0].width, height: views[0].height, touch, isMobile, selectors, scale });
    try {
      lines[name] = await sweepLines(opened.page, selectors, views);
      if (opened.errors.length) throw new Error(`${label} ${name}: page errors: ${opened.errors.join('; ')}`);
    } finally { await opened.context.close(); }
  }
  return { lines, findings: moreLinesThanBase(lines.base, lines.candidate) };
}

// The whole matrix on two served builds: engines, fonts, Postpone, text sizes
// (Chrome's minimum font size in Chromium only) and the phone and wide views.
export async function sweepBuilds(builds, options, { playwright, log = () => {} }) {
  const cases = [], findings = [];
  for (const engineName of options.engines) {
    const engine = playwright[engineName];
    const browser = await engine.launch({ headless: true, ...(engineName === 'chromium' ? { channel: options.channel } : {}) });
    try {
      for (const fonts of options.fonts) for (const postpone of options.postpone) for (const text of options.text) {
        if (text === 'minimum' && engineName !== 'chromium') continue; // WebKit has no minimum font setting to set
        const textLabel = text === 'minimum' ? `Chrome minimum ${options.minimumFontSize}px` : `${text} text`;
        const host = text === 'minimum' ? chromeMinimumFontHost(engine, options.minimumFontSize, { channel: options.channel }) : browser;
        for (const kind of ['phone', 'wide']) {
          const views = kind === 'phone' ? PHONE_WIDTHS.map(width => ({ width, height: PHONE_HEIGHT })) : WIDE_VIEWS;
          const label = `${engineName} fonts:${fonts} postpone:${postpone} ${textLabel} ${kind}`;
          const { lines, findings: extra } = await compareCase(host, builds, { board: steadyBoard({ postpone: postpone === 'on' }), fonts, views,
            touch: kind === 'phone', isMobile: kind === 'phone' && engineName === 'chromium', selectors: options.selectors, scale: TEXT_SCALES[text] ?? 1, label });
          cases.push({ label, engine: engineName, fonts, postpone, text, kind, widths: views.map(v => v.width), lines, findings: extra });
          for (const finding of extra) { findings.push({ case: label, ...finding }); log(describeFinding(label, finding)); }
        }
      }
    } finally { await browser.close(); }
  }
  return { cases, findings };
}

export async function runSweep(options, { playwright, log = () => {} }) {
  const builds = { base: await serveBuild(options.repo, options.base), candidate: await serveBuild(options.repo, options.candidate) };
  try {
    const { cases, findings } = await sweepBuilds(builds, options, { playwright, log });
    return { base: { ref: options.base, sha: builds.base.sha }, candidate: { ref: options.candidate, sha: builds.candidate.sha }, selectors: options.selectors, cases, findings };
  } finally { await builds.base.close(); await builds.candidate.close(); }
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + '\n'); return 2; }
  if (options.help) { process.stdout.write(USAGE + '\n'); return 0; }
  const moduleUrl = options.playwrightModule ? pathToFileURL(options.playwrightModule).href : process.env.LANDSCAPE_PLAYWRIGHT || process.env.PLAYWRIGHT_MODULE || 'playwright';
  let result;
  try {
    const playwright = await import(moduleUrl);
    result = await runSweep(options, { playwright, log: line => process.stdout.write(line + '\n') });
  } catch (error) { process.stderr.write(`layout sweep could not finish: ${error.message}\n`); return 2; }
  if (options.output) fs.writeFileSync(options.output, JSON.stringify(result, null, 1) + '\n');
  const compared = result.cases.reduce((sum, c) => sum + c.widths.length, 0);
  process.stdout.write(`${result.findings.length ? result.findings.length + ' row widths take more lines than' : 'No row takes more lines than'} base ${result.base.sha ?? result.base.ref}` +
    ` on candidate ${result.candidate.sha ?? 'working tree'} across ${result.cases.length} cases and ${compared} widths.\n`);
  return result.findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
