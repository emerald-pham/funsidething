import '../../tests/isolate-git-env.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs, moreLinesThanBase, serveBuild, runSweep, PHONE_WIDTHS, WIDE_VIEWS } from './layout-sweep.mjs';

test('layout sweep: arguments need a base and at least one row selector, repeat --selector, and refuse unknown lists', () => {
  const options = parseArgs(['--base', 'origin/main', '--selector', '.card.bench + *', '--selector', '.card.cand + *', '--engines', 'webkit', '--text', '150%,minimum']);
  assert.equal(options.base, 'origin/main');
  assert.equal(options.candidate, 'WORKTREE', 'the candidate defaults to the working tree');
  assert.deepEqual(options.selectors, ['.card.bench + *', '.card.cand + *']);
  assert.deepEqual(options.engines, ['webkit']);
  assert.deepEqual(options.text, ['150%', 'minimum']);
  assert.deepEqual(parseArgs(['--base', 'x', '--selector', '.decide']).fonts, ['web', 'blocked'], 'web fonts are swept loaded and blocked by default');
  assert.throws(() => parseArgs(['--selector', '.decide']), /--base is required/);
  assert.throws(() => parseArgs(['--base', 'x']), /--selector is required/);
  assert.throws(() => parseArgs(['--base', 'x', '--selector', '.decide', '--engines', 'firefox']), /--engines takes chromium, webkit/);
  assert.throws(() => parseArgs(['--base', 'x', '--selector', '.decide', '--minimum-font-size', '3']), /--minimum-font-size/);
  assert.throws(() => parseArgs(['--base', '--selector', '.decide']), /--base needs a value/);
});

test('layout sweep: the sweep covers every phone width from 320 to 480 px at 1 px steps, plus tablet and desktop', () => {
  assert.equal(PHONE_WIDTHS.length, 161);
  assert.equal(PHONE_WIDTHS[0], 320);
  assert.equal(PHONE_WIDTHS.at(-1), 480);
  assert.ok(PHONE_WIDTHS.every((w, i) => i === 0 || w - PHONE_WIDTHS[i - 1] === 1));
  assert.deepEqual(WIDE_VIEWS.map(v => v.width), [768, 1280]);
});

test('layout sweep: a row that takes more lines on the candidate, or is missing there, is reported by width; fewer or equal lines are not', () => {
  const base = { 406: { '.cand': [1], '.bench': [2] }, 407: { '.cand': [1], '.bench': [2] }, 408: { '.cand': [2], '.bench': [2] } };
  const candidate = { 406: { '.cand': [1], '.bench': [1] }, 407: { '.cand': [2], '.bench': [2] }, 408: { '.cand': [2], '.bench': [] } };
  assert.deepEqual(moreLinesThanBase(base, candidate), [
    { width: 407, selector: '.cand', index: 0, base: 1, candidate: 2 },
    { width: 408, selector: '.bench', index: 0, base: 2, candidate: null },
  ]);
  assert.deepEqual(moreLinesThanBase(base, base), []);
});

function fixtureRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-sweep-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(repo, 'index.html'), '<!doctype html><template id="appChangelogCurrent"><div data-app-fingerprint="HASH"></div></template><p>committed</p>');
  fs.writeFileSync(path.join(repo, 'sw.js'), 'const CACHE_NAME = "chain-scanner-shell-HASH";\ncache.addAll([\'./\', \'index.html\']);\n');
  git('add', '.'); git('commit', '-qm', 'fixture');
  fs.writeFileSync(path.join(repo, 'index.html'), '<!doctype html><template id="appChangelogCurrent"><div data-app-fingerprint="HASH"></div></template><p>working tree</p>');
  return repo;
}

test('layout sweep: a Git ref and the working tree are each served with the shell identity stamped, as the Pages deploy serves them', async () => {
  const repo = fixtureRepo();
  const base = await serveBuild(repo, 'HEAD'), candidate = await serveBuild(repo, 'WORKTREE');
  try {
    const committed = await (await fetch(base.url)).text(), working = await (await fetch(candidate.url)).text();
    assert.match(committed, /<p>committed<\/p>/);
    assert.match(working, /<p>working tree<\/p>/);
    assert.match(base.fingerprint, /^[0-9a-f]{64}$/, 'the placeholder is stamped');
    assert.notEqual(base.fingerprint, candidate.fingerprint, 'each build is stamped from its own files');
    assert.match(base.sha, /^[0-9a-f]{40}$/);
    assert.equal((await fetch(base.url + 'missing.js')).status, 404);
  } finally { await base.close(); await candidate.close(); fs.rmSync(repo, { recursive: true, force: true }); }
});

// A stand-in Playwright that answers the sweep's page ops: the candidate's row
// wraps onto a second line from 407 to 432 px, as #2460's first hint did.
function fakePlaywright({ loadedFonts = 0, minimumTakes = true } = {}) {
  const seen = { persistent: 0, scales: [] };
  let baseUrl = null;
  const context = (minimum = null) => {
    const state = { minimum };
    const page = {
      on() {}, isClosed: () => false, async close() {}, async setContent() {}, async waitForFunction() { return true; },
      async goto(url) { state.url = url; baseUrl ??= url; },
      async setViewportSize(size) { state.width = size.width; },
      async evaluate(fn, arg) {
        if (arg.op === 'fonts') return loadedFonts;
        if (arg.op === 'settle') return true;
        if (arg.op === 'minimum') return minimumTakes ? state.minimum : 1;
        if (arg.op === 'scale') { seen.scales.push(arg.scale); return 40; }
        if (arg.op === 'lines') {
          const wraps = state.url !== baseUrl && state.width >= 407 && state.width <= 432;
          return Object.fromEntries(arg.selectors.map(s => [s, [s === '.card.cand + *' && wraps ? 2 : 1]]));
        }
        throw new Error('unexpected op ' + arg.op);
      },
    };
    return { async route() {}, async addInitScript() {}, pages: () => [], async newPage() { return page; }, async close() {}, once() {} };
  };
  const engine = {
    async launch() { return { async newContext() { return context(); }, async close() {} }; },
    async launchPersistentContext() { seen.persistent++; return context(16); },
  };
  return { seen, playwright: { chromium: engine, webkit: engine } };
}

test("layout sweep: prints each width where the candidate takes more lines than the base, across engines, fonts, Postpone and text sizes, with Chrome's minimum font size in Chromium only", async () => {
  const repo = fixtureRepo();
  try {
    const fake = fakePlaywright(), lines = [];
    const options = parseArgs(['--repo', repo, '--base', 'HEAD', '--selector', '.card.bench + *', '--selector', '.card.cand + *', '--fonts', 'blocked', '--postpone', 'on']);
    const result = await runSweep(options, { playwright: fake.playwright, log: line => lines.push(line) });
    // chromium: 100/150/200/minimum, webkit: 100/150/200, each phone and wide.
    assert.equal(result.cases.length, (4 + 3) * 2);
    assert.equal(fake.seen.persistent, 2 * 2, 'a fresh Chrome profile for each minimum-font page');
    assert.deepEqual([...new Set(fake.seen.scales)].sort(), [1.5, 2]);
    const phoneCases = result.cases.filter(c => c.kind === 'phone');
    assert.ok(phoneCases.every(c => c.findings.map(f => f.width).join() === Array.from({ length: 26 }, (_, i) => 407 + i).join()), 'every phone case finds 407-432 px');
    assert.ok(result.cases.filter(c => c.kind === 'wide').every(c => !c.findings.length));
    assert.equal(result.findings.length, 26 * 7);
    assert.ok(lines.includes('webkit fonts:blocked postpone:on 150% text phone 412px .card.cand + *: 1 -> 2 lines'), lines.slice(0, 3).join('\n'));
    assert.ok(lines.includes('chromium fonts:blocked postpone:on Chrome minimum 16px phone 430px .card.cand + *: 1 -> 2 lines'));
    assert.ok(!lines.some(line => / \.card\.bench \+ \*/.test(line)), 'the row that keeps its lines is not reported');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('layout sweep: a case whose fonts or minimum font size did not apply stops the sweep instead of passing', async () => {
  const repo = fixtureRepo();
  try {
    const blocked = parseArgs(['--repo', repo, '--base', 'HEAD', '--selector', '.decide', '--fonts', 'blocked', '--engines', 'webkit', '--text', '100%']);
    await assert.rejects(runSweep(blocked, { playwright: fakePlaywright({ loadedFonts: 3 }).playwright }), /3 web fonts loaded while blocked/);
    const web = parseArgs(['--repo', repo, '--base', 'HEAD', '--selector', '.decide', '--fonts', 'web', '--engines', 'webkit', '--text', '100%']);
    await assert.rejects(runSweep(web, { playwright: fakePlaywright({ loadedFonts: 0 }).playwright }), /no web font loaded/);
    const minimum = parseArgs(['--repo', repo, '--base', 'HEAD', '--selector', '.decide', '--fonts', 'blocked', '--engines', 'chromium', '--text', 'minimum']);
    await assert.rejects(runSweep(minimum, { playwright: fakePlaywright({ minimumTakes: false }).playwright }), /minimum font size did not take effect/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
