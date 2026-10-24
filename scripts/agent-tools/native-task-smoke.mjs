// Reviewed native release-driver controls: public verification or an explicit signed-out local fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitForTruthyProbe } from './async-probe.mjs';

export const PUBLIC_ORIGINS = Object.freeze([
  'https://emerald-pham.github.io/funsidething/',
  'https://chain-scanner.web.app/',
]);

export function classifyOrigin(origin, mode) {
  if (mode === 'online' || mode === 'offline') {
    assert.ok(PUBLIC_ORIGINS.includes(origin), 'Public smoke mode requires an approved HTTPS origin');
    return { kind: 'public', url: new URL(origin) };
  }
  assert.equal(mode, 'local-fixture', 'Mode must be online, offline, or local-fixture');
  let url;
  try { url = new URL(origin); }
  catch { assert.fail('Local fixture origin must be an explicit http://127.0.0.1:<port> origin'); }
  assert.equal(url.protocol, 'http:', 'Local fixture must use plain loopback HTTP');
  assert.equal(url.hostname, '127.0.0.1', 'Local fixture must use the literal 127.0.0.1 address');
  assert.match(url.port, /^\d+$/, 'Local fixture origin must include an explicit port');
  assert.ok(Number(url.port) > 0 && Number(url.port) <= 65535, 'Local fixture port must be valid');
  assert.equal(url.username, '', 'Credentials are forbidden in a local fixture origin');
  assert.equal(url.password, '', 'Credentials are forbidden in a local fixture origin');
  assert.equal(url.search, '', 'Query strings are forbidden in a local fixture origin');
  assert.equal(url.hash, '', 'Fragments are forbidden in a local fixture origin');
  assert.equal(url.pathname, '/', 'Local fixture accepts an origin only, without a path');
  assert.ok(origin === url.origin || origin === url.origin + '/', 'Local fixture origin must be a literal loopback origin');
  return { kind: 'local-fixture', url };
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fullSha = value => /^[a-f0-9]{40}$/.test(value);

function gitBytes(repo, source, relative) {
  return execFileSync('git', ['show', source + ':' + relative], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
}

function productShell(repo, source) {
  const sw = gitBytes(repo, source, 'sw.js').toString('utf8');
  const match = sw.match(/\.addAll\(\[([\s\S]*?)\]\s*\.map/);
  assert.ok(match, 'Committed service worker must expose its immutable shell list');
  const files = [...new Set([...match[1].matchAll(/["']([^"']+)["']/g)].map(row =>
    row[1] === './' ? 'index.html' : row[1].replace(/^\.\//, ''),
  ))];
  assert.ok(files.includes('index.html'), 'Committed shell must include index.html');
  return [...files, 'sw.js'];
}

function contentType(relative) {
  if (relative.endsWith('.html')) return 'text/html; charset=utf-8';
  if (relative.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (relative.endsWith('.css')) return 'text/css; charset=utf-8';
  if (relative.endsWith('.svg')) return 'image/svg+xml';
  if (relative.endsWith('.png')) return 'image/png';
  if (relative.endsWith('.webmanifest')) return 'application/manifest+json';
  if (relative.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function parseCli(argv) {
  const [repo, source, tree, origin, output, engine = 'chromium', mode = 'online'] = argv;
  assert.ok(path.isAbsolute(repo), 'Repository path must be absolute');
  assert.ok(path.isAbsolute(output), 'Output report path must be absolute');
  assert.ok(output.endsWith('.json'), 'Output report path must end in .json');
  assert.ok(!fs.existsSync(output), 'Output report path must be new');
  assert.ok(['webkit', 'chromium'].includes(engine), 'Engine must be webkit or chromium');
  assert.ok(['online', 'offline', 'local-fixture'].includes(mode), 'Mode must be online, offline, or local-fixture');
  assert.ok(mode !== 'offline' || engine === 'chromium', 'Offline emulation uses the supported Chromium control');
  assert.ok(mode !== 'local-fixture' || engine === 'chromium', 'The local fixture control is restricted to Chromium');
  assert.ok(fullSha(source) && fullSha(tree), 'Explicit full product commit and tree are required');
  const target = classifyOrigin(origin, mode);
  return { repo, source, tree, origin, output, engine, mode, target };
}

async function runNativeSmoke(options) {
  const { repo, source, tree, origin, output, engine, mode, target } = options;
  const fixtureOrigin = target.url.origin;
  assert.equal(execFileSync('git', ['rev-parse', source + '^{tree}'], { cwd: repo, encoding: 'utf8' }).trim(), tree,
    'Explicit source commit must resolve to the declared tree');
  const shellFiles = productShell(repo, source);
  const sourceAssets = new Map(shellFiles.map(relative => [relative, gitBytes(repo, source, relative)]));
  for (const [relative, expected] of sourceAssets) {
    assert.deepEqual(fs.readFileSync(path.join(repo, relative)), expected,
      'Checkout product asset differs from the explicit Git source: ' + relative);
  }
  const expectedDocument = sourceAssets.get('index.html');
  const { chromium, webkit, devices } = await import(pathToFileURL(path.join(repo, 'node_modules/playwright/index.mjs')));
  const { resolveExpectedFirstRunHelp } = await import(pathToFileURL(path.join(repo, 'scripts/browser-fixture-setup.mjs')));
  const fixtureSdk = mode === 'local-fixture'
    ? await import(pathToFileURL(path.join(repo, 'scripts/installed-client-fixture.mjs')))
    : null;
  const report = {
    source, tree, origin, engine, mode, proofScope: mode === 'local-fixture' ? 'local-fixture' : 'actual-public-origin',
    startedAt: new Date().toISOString(), status: 'running', productAssets: Object.fromEntries([...sourceAssets].map(([file, bytes]) => [file, hash(bytes)])),
    pageErrors: [], crashes: 0, navigations: 0, cloudMutationRequests: [], actions: [],
    limits: mode === 'local-fixture'
      ? ['Synthetic signed-out local fixture serves exact committed app bytes; it is not deployed-byte or public-origin proof.', 'Trusted Chromium mouse input is not physical touch, iOS, or standalone-device proof.', 'Firebase SDK modules and cloud RPC are synthetic; no account or provider writes are used.']
      : ['Fresh ephemeral signed-out browser with trusted native browser input; not physical touch/iOS/standalone proof.', 'Public origin/source match does not prove private-account or authenticated gameplay behavior.'],
  };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  save();

  let browser, context, page, server;
  const externalRequestsBlocked = [];
  const externalRequestsEscaped = [];
  const fixtureRpc = [];
  const transportRequests = [];
  try {
    if (mode === 'local-fixture') {
      const sdkPrefix = '/fixture-sdk/';
      const sdkSources = {
        'firebase-app.js': fixtureSdk.appModule,
        'firebase-auth.js': fixtureSdk.authModule,
        'firebase-firestore.js': fixtureSdk.firestoreModule,
      };
      server = http.createServer((request, response) => {
        try {
          const requestUrl = new URL(request.url, fixtureOrigin);
          if (requestUrl.pathname.startsWith('/transport-probe/')) {
            transportRequests.push(requestUrl.pathname);
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ path: requestUrl.pathname }));
            return;
          }
          if (requestUrl.pathname.startsWith(sdkPrefix)) {
            const name = requestUrl.pathname.slice(sdkPrefix.length);
            assert.ok(Object.hasOwn(sdkSources, name), 'Only the three known synthetic SDK modules are served');
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(sdkSources[name]);
            return;
          }
          const relative = decodeURIComponent(requestUrl.pathname.slice(1)) || 'index.html';
          assert.ok(!relative.split('/').includes('..') && !path.isAbsolute(relative), 'Fixture asset path must stay inside the repository');
          const bytes = sourceAssets.get(relative) ?? gitBytes(repo, source, relative);
          const checkout = fs.readFileSync(path.join(repo, relative));
          assert.deepEqual(checkout, bytes, 'Every served app byte must match the explicit Git source: ' + relative);
          sourceAssets.set(relative, bytes);
          response.writeHead(200, { 'Content-Type': contentType(relative), 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
          response.end(bytes);
        } catch (error) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Missing or non-source fixture asset');
        }
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number(target.url.port), '127.0.0.1', resolve);
      });
      report.fixture = { host: '127.0.0.1', port: server.address().port, auth: 'signed-out', profile: 'fresh ephemeral Chromium context' };
    }

    browser = await ({ chromium, webkit })[engine].launch({ headless: true });
    report.runtime = { engine, version: browser.version(), descriptor: devices['iPhone 16 Pro'] };
    context = await browser.newContext({ ...devices['iPhone 16 Pro'], serviceWorkers: 'allow' });
    page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('crash', () => report.crashes++);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) report.navigations++; });
    page.on('request', request => {
      const requestOrigin = new URL(request.url()).origin;
      if (/firestore\.googleapis\.com/.test(request.url()) && /:(?:commit|batchWrite)(?:\?|$)|\/Firestore\/Write\/channel/.test(request.url())) {
        report.cloudMutationRequests.push({ method: request.method(), origin: requestOrigin });
      }
    });
    page.on('requestfinished', request => {
      if (mode === 'local-fixture' && new URL(request.url()).origin !== fixtureOrigin) externalRequestsEscaped.push(new URL(request.url()).origin);
    });
    if (mode === 'local-fixture') {
      await context.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== fixtureOrigin) {
          externalRequestsBlocked.push(new URL(route.request().url()).origin);
          await route.abort();
        } else await route.continue();
      });
      await context.exposeBinding('__installedRPC', (_, kind, args) => {
        fixtureRpc.push({ kind, args });
        throw new Error('Signed-out local smoke must not use synthetic cloud RPC');
      });
      await context.addInitScript(fixtureSdk.browserInit, {
        dbName: 'native-task-smoke-' + crypto.randomUUID(), authMode: 'signed-out', sdkBase: fixtureOrigin + '/fixture-sdk/',
      });
    }

    const response = await page.goto(mode === 'local-fixture' ? fixtureOrigin + '/' : origin, { waitUntil: 'domcontentloaded' });
    assert.ok(response, 'The requested document must load');
    const document = await response.body();
    report.documentSha256 = hash(document);
    assert.deepEqual(document, expectedDocument, mode === 'local-fixture'
      ? 'Local fixture must serve the explicit Git index.html bytes'
      : 'Actual public app must be the reviewed Git source');
    await page.waitForSelector('html[data-app-ready="true"]');
    if (mode === 'local-fixture') {
      assert.equal(await page.evaluate(() => LivingSky.readMotion(localStorage)), 'reduced',
        'The isolated fixture keeps its explicit reduced-motion preference');
    } else {
      await page.locator('#motionDialog[open]').waitFor({ state: 'visible' });
      await page.locator('[data-landscape-motion="normal"]').click();
      await page.locator('#motionDialog[open]').waitFor({ state: 'hidden' });
      await page.locator('#modalRoot #faqsTitle').waitFor({ state: 'visible' });
    }
    await resolveExpectedFirstRunHelp(page);
    assert.equal(await page.evaluate(() => state.tasks.length), 0, 'Fresh profile is empty before synthetic edits');
    assert.equal(await page.evaluate(() => window.CloudSync?.user ?? null), null, 'Smoke stays signed out before synthetic edits');

    for (let index = 0; index < 12; index++) {
      const title = 'Release check task ' + String(index + 1).padStart(2, '0');
      await page.locator('#addInput').fill(title);
      await page.locator('#addButton').tap();
      await page.waitForFunction(value => state.tasks.some(task => task.title === value), title, { timeout: 2_000 });
      assert.equal(await page.evaluate(value => state.tasks.some(task => task.title === value), title), true);
      report.actions.push({ act: 'add', title });
      save();
    }

    await page.locator('[data-act="start-scan"]').first().tap();
    await page.waitForFunction(() => state.mode === 'scan' && !!state.candidateId, null, { timeout: 2_000 });
    const priorFacts = await page.evaluate(() => state.decisionEvents.map(row => row.id));
    await page.evaluate(() => {
      window.__releaseClicks = [];
      document.addEventListener('click', event => {
        const element = event.target.closest('[data-act]');
        const action = element?.dataset.act;
        if (!['yes', 'bench-done'].includes(action)) return;
        window.__releaseClicks.push({
          act: action, detail: event.detail, isTrusted: event.isTrusted, pointerType: event.pointerType || null,
          dataset: { ...element.dataset }, candidateAtClick: state.candidateId, benchmarkAtClick: benchmark()?.id,
          factIdsAtClick: state.decisionEvents.map(row => row.id),
        });
      }, true);
    });

    const choices = [];
    for (let index = 0; index < 20; index++) {
      const action = index < 10 ? 'yes' : 'bench-done';
      const before = await page.evaluate(() => ({ candidate: state.candidateId, benchmark: benchmark()?.id, clicks: window.__releaseClicks.length }));
      const control = page.locator('[data-act="' + action + '"]').first();
      if (index === 10) await control.dblclick({ delay: 40 });
      else await control.click();
      const delivered = await page.evaluate(({ count, action }) => window.__releaseClicks.slice(count).filter(row => row.act === action),
        { count: before.clicks, action });
      const guardedDoubleClick = index === 10;
      assert.equal(delivered.length, guardedDoubleClick ? 2 : 1, 'Each requested native click reaches the delegated control');
      const intent = delivered[0];
      const id = action === 'yes' ? intent.dataset.candidate : intent.benchmarkAtClick;
      assert.ok(id, 'Native task gesture identifies its current task');
      assert.equal(intent.detail, 1, 'Accepted task gesture is one eligible click');
      assert.equal(intent.isTrusted, true, 'Task input uses the browser native input path');
      if (action === 'yes') assert.equal(intent.candidateAtClick, id);
      if (action === 'bench-done' && intent.dataset.benchmark) assert.equal(intent.dataset.benchmark, id);
      if (guardedDoubleClick) {
        const rejected = delivered[1];
        assert.equal(rejected.detail, 2, 'The double-click control delivers an actual detail-2 event');
        assert.equal(rejected.isTrusted, true, 'The detail-2 event is trusted browser input');
        assert.equal(rejected.act, 'bench-done');
      }
      report.attemptedAction = { act: action, id, before, intent, secondClick: guardedDoubleClick ? delivered[1] : undefined };
      save();
      await page.waitForFunction(({ action, id }) => action === 'yes'
        ? state.chain.at(-1) === id
        : state.tasks.find(task => task.id === id)?.done === true, { action, id }, { timeout: 2_000 });
      assert.equal(await page.evaluate(({ action, id }) => action === 'yes'
        ? state.chain.at(-1) === id
        : state.tasks.find(task => task.id === id)?.done === true, { action, id }), true);
      const fresh = await page.evaluate(ids => state.decisionEvents.filter(row => !ids.includes(row.id)), intent.factIdsAtClick);
      assert.equal(fresh.length, 1, 'Exactly one new decision fact is accepted for the detail-1 gesture');
      const fact = fresh[0];
      if (action === 'yes') {
        assert.equal(fact.kind, 'comparison');
        assert.equal(fact.action, 'yes');
        assert.equal(fact.candidateId, id);
        assert.equal(fact.benchmarkId, intent.dataset.benchmark);
      } else {
        assert.equal(fact.kind, 'completion');
        assert.equal(fact.taskId, id);
      }
      if (guardedDoubleClick) {
        const secondClickBaseline = delivered[1].factIdsAtClick;
        assert.equal(secondClickBaseline.length, intent.factIdsAtClick.length + 1,
          'Detail-2 follows the single accepted detail-1 fact');
        const afterSecondClick = await page.evaluate(ids => state.decisionEvents.filter(row => !ids.includes(row.id)), secondClickBaseline);
        assert.deepEqual(afterSecondClick, [], 'The intentional detail-2 event creates no extra completion fact');
        report.doubleClickRejection = { detail: delivered[1].detail, trusted: delivered[1].isTrusted, extraFacts: afterSecondClick.length };
      }
      choices.push({ act: action, id, factId: fact.id });
      report.actions.push({ act: action, id, before, intent, acceptedFact: fact });
      save();
    }

    assert.equal(choices.length, 20);
    assert.equal(new Set(choices.map(row => row.factId)).size, 20, 'Every accepted gesture has its own exact fact');
    assert.equal(report.actions.filter(row => row.act === 'yes').length, 10);
    assert.equal(report.actions.filter(row => row.act === 'bench-done').length, 10);
    assert.equal(report.actions.filter(row => row.act === 'add').length, 12);
    const beforeUndo = await page.evaluate(() => state.tasks.filter(task => task.done).length);
    await page.locator('[data-act="undo"]').tap();
    await page.waitForFunction(count => state.tasks.filter(task => task.done).length === count - 1, beforeUndo, { timeout: 2_000 });
    assert.equal(await page.evaluate(() => state.tasks.filter(task => task.done).length), beforeUndo - 1);
    report.actions.push({ act: 'undo' });
    assert.equal(await page.evaluate(() => window.CloudSync?.user ?? null), null, 'Smoke remains signed out after task use');
    assert.equal(report.navigations, 1, 'No unrequested reload during task use');
    assert.equal(report.crashes, 0);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.cloudMutationRequests, []);

    const gestureFacts = report.actions.filter(row => row.acceptedFact).map(row => row.acceptedFact);
    assert.equal(gestureFacts.length, 20);
    assert.equal(new Set(gestureFacts.map(row => row.id)).size, 20);
    const doneChoices = choices.filter(row => row.act === 'bench-done');
    const undoneTask = doneChoices.at(-1).id;
    const earlierDone = doneChoices.slice(0, -1).map(row => row.id);
    let probes = 0, readErrors = 0;
    const durabilityStarted = performance.now();
    const durable = await waitForTruthyProbe(async () => {
      probes++;
      const snapshot = await page.evaluate(async () => {
        const before = JSON.stringify(state);
        const head = (await ScannerDeviceStore.readHead())?.payload ?? null;
        const after = JSON.stringify(state);
        return { before, head, after };
      }).catch(() => { readErrors++; return null; });
      if (!snapshot || snapshot.before !== snapshot.after || snapshot.after !== snapshot.head) return false;
      const saved = JSON.parse(snapshot.head);
      if (saved.tasks.length !== 12 || !gestureFacts.every(fact => saved.decisionEvents.some(row => JSON.stringify(row) === JSON.stringify(fact)))) return false;
      if (!earlierDone.every(id => saved.tasks.find(row => row.id === id)?.done === true) || saved.tasks.find(row => row.id === undoneTask)?.done !== false) return false;
      return snapshot;
    }, { timeoutMs: 15_000, pollIntervalMs: 25 });
    assert.equal(durable.before, durable.head);
    assert.equal(durable.after, durable.head);
    const saved = JSON.parse(durable.head);
    const accepted = saved.decisionEvents.filter(row => !priorFacts.includes(row.id));
    report.ordinaryAutosaveReadback = true;
    report.acceptedFacts = accepted.length;
    report.acceptedGestureFacts = gestureFacts.length;
    report.durableHeadSha256 = hash(durable.head);
    report.durabilityObservation = {
      probes, readErrors, elapsedMs: performance.now() - durabilityStarted, allowanceMs: 15_000,
      consistentBeforeHeadAfter: true, all20ExactGestureFactsInHead: true,
      earlierDoneCount: earlierDone.length, lastDoneUndone: true,
    };
    report.taskInput = {
      method: 'native locator.click() single pointer input; one deliberate native dblclick for the guard control',
      requiresTrusted: true, acceptedRequiresDetail: 1, detail2Accepted: false,
      silentRetries: false, syntheticDetailForcing: false,
    };
    const screenshot = output.replace(/\.json$/, '.png');
    await page.screenshot({ path: screenshot });

    await page.reload();
    await page.waitForSelector('html[data-app-ready="true"]');
    assert.equal(await page.evaluate(facts => facts.every(fact => state.decisionEvents.some(row => JSON.stringify(row) === JSON.stringify(fact))), accepted), true);
    assert.equal(await page.evaluate(() => state.tasks.length), 12);
    assert.equal(await page.evaluate(({ earlierDone, undoneTask }) => earlierDone.every(id => state.tasks.find(row => row.id === id)?.done === true) &&
      state.tasks.find(row => row.id === undoneTask)?.done === false, { earlierDone, undoneTask }), true);
    report.durableReopen = true;
    const serviceWorker = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const registration = await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => setTimeout(() => resolve(null), 10_000))]);
      return { supported: true, active: registration?.active?.scriptURL || null, controlled: !!navigator.serviceWorker.controller };
    });
    report.serviceWorker = serviceWorker;
    const requireOffline = mode === 'offline' || mode === 'local-fixture';
    if (requireOffline && serviceWorker.active) {
      if (!serviceWorker.controlled) {
        await page.reload();
        await page.waitForSelector('html[data-app-ready="true"]');
      }
      assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, 'Offline checks use the real installed worker');
      if (mode === 'local-fixture') {
        await page.evaluate(async sdkBase => {
          await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(async file => {
            const response = await fetch(sdkBase + file, { cache: 'no-store' });
            if (!response.ok) throw new Error('Could not cache the synthetic SDK module ' + file);
            await response.arrayBuffer();
          }));
        }, fixtureOrigin + '/fixture-sdk/');
      }
      const onlineProbe = '/transport-probe/online-' + crypto.randomUUID();
      const offlineProbe = '/transport-probe/offline-' + crypto.randomUUID();
      if (mode === 'local-fixture') {
        const online = await page.evaluate(async probe => {
          const response = await fetch(probe, { cache: 'no-store' });
          return { status: response.status, body: await response.json() };
        }, fixtureOrigin + onlineProbe);
        assert.equal(online.status, 200);
        assert.equal(online.body.path, onlineProbe);
      } else {
        const online = await page.evaluate(async probe => {
          try { const response = await fetch(probe, { cache: 'no-store' }); return { status: response.status, transport: true }; }
          catch (error) { return { transport: false, error: String(error) }; }
        }, fixtureOrigin + offlineProbe + '?online=' + Date.now());
        assert.equal(online.transport, true);
        report.onlineTransportControl = online;
      }
      if (mode === 'local-fixture') report.onlineTransportControl = { status: 200, path: onlineProbe };
      await context.setOffline(true);
      const offline = await page.evaluate(async probe => {
        try { const response = await fetch(probe, { cache: 'no-store' }); return { failed: false, status: response.status, navigatorOnline: navigator.onLine }; }
        catch (error) { return { failed: true, name: error.name, navigatorOnline: navigator.onLine }; }
      }, fixtureOrigin + offlineProbe);
      assert.equal(offline.failed, true, 'An uncached network-only transport probe fails while offline');
      if (mode === 'local-fixture') assert.ok(!transportRequests.includes(offlineProbe), 'Offline probe cannot reach the live local listener');
      else report.offlineTransport = offline;
      const offlineResponse = await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('html[data-app-ready="true"]');
      assert.ok(offlineResponse);
      assert.deepEqual(await offlineResponse.body(), expectedDocument, 'Installed worker reopens the exact Git-source document offline');
      assert.equal(await page.evaluate(facts => facts.every(fact => state.decisionEvents.some(row => JSON.stringify(row) === JSON.stringify(fact))), accepted), true);
      assert.equal(await page.evaluate(({ earlierDone, undoneTask }) => state.tasks.length === 12 && earlierDone.every(id => state.tasks.find(row => row.id === id)?.done === true) &&
        state.tasks.find(row => row.id === undoneTask)?.done === false, { earlierDone, undoneTask }), true);
      report.offlineReopen = true;
      if (mode === 'local-fixture') {
        report.offlineTransport = { ...offline, listenerStillOpen: server.listening, offlineProbeReachedListener: transportRequests.includes(offlineProbe) };
      }
    } else {
      report.offlineReopen = mode === 'online' ? 'not-requested-online-case' : 'unverified: worker unavailable';
    }
    if (requireOffline) assert.equal(report.offlineReopen, true, 'Requested offline proof requires a real worker and reopen');
    assert.equal(report.crashes, 0);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.cloudMutationRequests, []);
    if (mode === 'local-fixture') {
      assert.deepEqual(externalRequestsEscaped, [], 'Local fixture blocks every request outside its literal loopback origin');
      assert.deepEqual(fixtureRpc, [], 'Signed-out fixture performs no cloud reads or writes');
      assert.equal(server.listening, true, 'Offline transport control keeps its listener available');
      report.transportRequests = transportRequests;
      report.externalRequestsBlocked = externalRequestsBlocked;
      report.externalRequestsEscaped = externalRequestsEscaped;
      report.fixtureRpc = fixtureRpc;
      report.localListenerStillOpen = server.listening;
    }
    report.status = 'passed';
    return report;
  } catch (error) {
    report.status = 'failed';
    report.error = { name: error.name, message: error.message, stack: error.stack };
    if (page) report.failureState = await page.evaluate(() => ({
      mode: state.mode, chain: state.chain, candidate: state.candidateId,
      tasks: state.tasks.map(task => ({ id: task.id, done: task.done, evergreen: task.evergreen })),
      events: state.decisionEvents, clicks: window.__releaseClicks,
      controls: [...document.querySelectorAll('[data-act="bench-done"]')].map(element => ({ dataset: { ...element.dataset }, disabled: element.disabled })),
    })).catch(error => ({ inspectionError: String(error) }));
    throw error;
  } finally {
    try { await context?.close(); report.cleanupContextClosed = true; }
    finally {
      try { await browser?.close(); report.cleanupBrowserClosed = true; }
      finally {
        if (server) {
          server.closeAllConnections();
          await new Promise(resolve => server.close(resolve));
        }
        report.cleanupServerClosed = true;
        report.completedAt = new Date().toISOString();
        save();
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    await runNativeSmoke(options);
    process.stdout.write(JSON.stringify({ output: options.output, status: 'passed', mode: options.mode }) + '\n');
  } catch (error) {
    process.stderr.write((error.stack || String(error)) + '\n');
    process.exitCode = 1;
  }
}
