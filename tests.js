import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

function slice(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker);
  if (s === -1 || e === -1 || e < s) throw new Error(`markers not found: ${startMarker} .. ${endMarker}`);
  return src.slice(s + startMarker.length, e);
}
const engineSrc = slice(html, "/*ENGINE-START*/", "/*ENGINE-END*/");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_SNIPPET = (seed) => `
Math.random = (function(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(${seed});
`;

function loadEngine(seed) {
  const sandbox = {};
  vm.createContext(sandbox);
  // Seed FIRST, inside the context — vm contexts don't expose their built-in
  // Math as a settable property on the outer sandbox object, so reassigning
  // Math.random has to happen as code run *in* the context, not from outside.
  if (seed !== undefined) vm.runInContext(SEED_SNIPPET(seed), sandbox);
  vm.runInContext(engineSrc, sandbox, { filename: "index.html#engine" });
  return sandbox;
}
// `const`/`let` at top level (SIGMA_FLOOR, BETA, TAU, ...) live in the script's
// lexical scope, not as properties of the sandbox object — unlike `function`
// declarations, which do attach. Read them by evaluating the bare name inside
// the same context instead of via the returned object.
function readConst(sandbox, name) {
  return vm.runInContext(name, sandbox);
}

/* =====================================================================
   Harness for the FULL app script (state, decide/*, addTask, deleteTask,
   parseTaskList, the new queue-gate, etc.) — the classic (non-module)
   <script> block, identified by its "use strict" opener so it doesn't
   depend on script ordering in the file.
   ===================================================================== */
function extractAppScript(src) {
  const m = src.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
  if (!m) throw new Error("could not find the main app <script> block");
  return '"use strict";' + m[1];
}
const appSrc = extractAppScript(html);

function makeFakeElement() {
  const el = {
    innerHTML: "", textContent: "", value: "", hidden: false, scrollTop: 0,
    dataset: {}, style: {},
    classList: {
      _set: new Set(),
      toggle(cls, force) {
        if (force === undefined) { this._set.has(cls) ? this._set.delete(cls) : this._set.add(cls); }
        else if (force) { this._set.add(cls); } else { this._set.delete(cls); }
      },
      add(cls) { this._set.add(cls); },
      remove(cls) { this._set.delete(cls); },
      contains(cls) { return this._set.has(cls); },
    },
    addEventListener() {}, removeEventListener() {},
    focus() {}, select() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {},
    appendChild() {}, scrollIntoView() {},
  };
  return el;
}

function makeDomShim() {
  const elements = new Map();
  const winListeners = {};
  const localStorageMap = new Map();

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeFakeElement());
      return elements.get(id);
    },
    querySelector() { return null; },   // "no modal open" by default
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement() { return makeFakeElement(); },
    body: { appendChild() {} },
  };
  const localStorage = {
    getItem(k) { return localStorageMap.has(k) ? localStorageMap.get(k) : null; },
    setItem(k, v) { localStorageMap.set(k, String(v)); },
    removeItem(k) { localStorageMap.delete(k); },
  };
  const window = {
    addEventListener(evt, fn) { (winListeners[evt] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(evt) {
      for (const fn of (winListeners[evt.type] || [])) fn(evt);
      return true;
    },
    localStorage,
    CloudSync: undefined,
  };
  window.window = window;
  return { document, window, localStorage, elements, winListeners };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function loadApp({ seed, cloudSyncFactory } = {}) {
  const shim = makeDomShim();
  if (cloudSyncFactory) shim.window.CloudSync = cloudSyncFactory(shim.window);
  const sandbox = {
    window: shim.window,
    document: shim.document,
    localStorage: shim.localStorage,
    console,
    JSON,
    // NOTE: deliberately NOT injecting the outer process's `Date` here — it's
    // passed by reference, so overriding Date.now on it (for time-travel
    // tests) would leak into the whole Node process. Leave Date unset and the
    // vm context auto-provisions its own separate, safely-overridable Date;
    // see setFakeTime() below, which overrides it via in-context code only.
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); } },
    setTimeout: (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); t.unref?.(); return t; },
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    confirm: () => true,
    alert: () => {},
    prompt: () => null,
  };
  vm.createContext(sandbox);
  if (seed !== undefined) vm.runInContext(SEED_SNIPPET(seed), sandbox);
  vm.runInContext(appSrc, sandbox, { filename: "index.html#app" });
  // `state` is a top-level `let`, reassigned wholesale by undo()/cloudPull() —
  // expose it as a live getter (re-reading the binding each time) rather than
  // a one-time snapshot, so it never goes stale after such a reassignment.
  Object.defineProperty(sandbox, "state", {
    get() { return vm.runInContext("state", sandbox); },
    configurable: true,
  });
  // `esc` is a top-level `const` arrow fn (not `function esc(){}`), so — like
  // SIGMA_FLOOR and state — it never attaches to the sandbox object on its
  // own. It's never reassigned though, so a one-time copy is fine here.
  vm.runInContext("this.esc = esc;", sandbox);
  await flush(); // let the boot IIFE's `await loadState()` resolve before returning
  return { ctx: sandbox, shim };
}

// Overrides Date.now() *inside one vm context only*, via in-context code —
// never touches the outer process's real Date, so it can't leak across tests.
function setFakeTime(sandbox, ts) {
  vm.runInContext(`Date.now = () => ${ts};`, sandbox);
}
function realNow(sandbox) {
  return vm.runInContext("Date.now()", sandbox);
}

test("app harness: boots cleanly with an empty state", async () => {
  const { ctx } = await loadApp();
  assert.ok(ctx.state, "state should be initialized after boot");
  assert.equal(ctx.state.tasks.length, 0);
  assert.equal(ctx.state.chain.length, 0);
  assert.equal(ctx.state.mode, "scan");
});

/* ---------- state mutations ---------- */

test("addTask: adds an open task; dot=true also pushes it onto the chain", async () => {
  const { ctx } = await loadApp();
  const t1 = ctx.addTask("Write scene", false);
  assert.equal(ctx.state.tasks.length, 1);
  assert.equal(t1.title, "Write scene");
  assert.equal(ctx.state.chain.length, 0);

  const t2 = ctx.addTask("Urgent fix", true);
  assert.equal(ctx.state.tasks.length, 2);
  assert.equal(ctx.state.chain.length, 1);
  assert.equal(ctx.state.chain[0], t2.id);
});

test("addTask: blank/whitespace-only titles are rejected", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.addTask("   ", false), null);
  assert.equal(ctx.state.tasks.length, 0);
});

test("decide('yes'): dots the candidate, clears it, and a new candidate is picked from the remaining pool", async () => {
  const { ctx } = await loadApp({ seed: 1 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.addTask("Task C", false);
  ctx.decide("can");            // start the chain first — yes/no need a benchmark to compare against
  const firstCandidate = ctx.state.candidateId;
  assert.ok(firstCandidate, "a ranked candidate should be presented once the chain has started");

  ctx.decide("yes");
  assert.equal(ctx.state.chain.length, 2);
  assert.equal(ctx.state.chain[1], firstCandidate, "the dotted task should be the one that was showing");
  assert.notEqual(ctx.state.candidateId, firstCandidate, "a fresh candidate should replace the dotted one");
  assert.ok(ctx.state.candidateId, "a new candidate should be offered (1 task remains in the pool)");
});

test("decide('no') and decide('cant'): candidate is marked considered, NOT added to the chain", async () => {
  const { ctx } = await loadApp({ seed: 2 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.addTask("Task C", false);
  ctx.decide("can");            // establish a benchmark so 'no' is a valid comparison
  const chainLen = ctx.state.chain.length;
  const cand = ctx.state.candidateId;
  ctx.decide("no");
  assert.equal(ctx.state.chain.length, chainLen, "'no' must not extend the chain");
  assert.equal(ctx.state.considered[cand], "no");
});

test("decide('cand-done'): completes the task directly without ever touching the chain", async () => {
  const { ctx } = await loadApp({ seed: 3 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  const cand = ctx.state.candidateId;
  ctx.decide("cand-done");
  const task = ctx.state.tasks.find((t) => t.id === cand);
  assert.equal(task.done, true);
  assert.equal(ctx.state.chain.length, 0, "cand-done must not add the task to the chain");
});

test("deleteTask: removes from tasks, the chain, and considered; clears candidateId if it was the deleted task", async () => {
  const { ctx } = await loadApp({ seed: 4 });
  const t1 = ctx.addTask("Task A", true); // dotted
  ctx.addTask("Task B", false);
  const cand = ctx.state.candidateId;

  ctx.deleteTask(cand);
  assert.equal(ctx.state.tasks.some((t) => t.id === cand), false);
  assert.notEqual(ctx.state.candidateId, cand);

  ctx.deleteTask(t1.id);
  assert.equal(ctx.state.chain.includes(t1.id), false, "deleting a dotted task must remove it from the chain too");
});

test("deleteTask: a null/undefined id is a safe no-op", async () => {
  const { ctx } = await loadApp();
  ctx.addTask("Task A", false);
  ctx.deleteTask(null);
  ctx.deleteTask(undefined);
  assert.equal(ctx.state.tasks.length, 1);
});

test("undo: reverses the most recent mutation (dotting a task)", async () => {
  const { ctx } = await loadApp({ seed: 5 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.decide("can");
  assert.equal(ctx.state.chain.length, 1);
  ctx.undo();
  assert.equal(ctx.state.chain.length, 0);
});

test("toggleContext: turning off a required context makes a task ineligible and ensureCandidate swaps it out", async () => {
  const { ctx } = await loadApp({ seed: 6 });
  // two contexts exist by default: c_home, c_laptop, c_car, c_work, c_quiet, c_errand
  const homeCtxId = ctx.state.contexts.find((c) => c.id === "c_home").id;
  const t = ctx.addTask("Needs home", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.ctx = [homeCtxId];
  ctx.addTask("No context needed", false);
  ctx.recomputeRanks?.();

  ctx.toggleContext(homeCtxId); // turn OFF "At home"
  assert.equal(ctx.isEligible(task, ctx.activeCtxSet()), false);
});

test("importList: dedupes against existing open tasks (case/whitespace-insensitive)", async () => {
  const { ctx } = await loadApp();
  ctx.addTask("Email the union rep", false);
  const { added, skipped } = ctx.importList("1. Email the union rep\n2. Fix the sink");
  assert.equal(added, 1);
  assert.equal(skipped, 1);
  assert.equal(ctx.state.tasks.length, 2);
});

test("clearCompleted: removes done tasks when confirm() is accepted, leaves them when declined", async () => {
  {
    const { ctx } = await loadApp(); // default confirm() => true
    const t = ctx.addTask("Task A", false);
    ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
    assert.equal(ctx.state.tasks.filter((x) => x.done).length, 1);
    ctx.clearCompleted();
    assert.equal(ctx.state.tasks.length, 0);
  }
  {
    const shim = makeDomShim();
    const sandbox = {
      window: shim.window, document: shim.document, localStorage: shim.localStorage,
      console, JSON, CustomEvent: class {}, setTimeout, clearTimeout,
      requestAnimationFrame: (fn) => setTimeout(fn, 0),
      confirm: () => false, alert: () => {}, prompt: () => null,
    };
    vm.createContext(sandbox);
    vm.runInContext(appSrc, sandbox, { filename: "index.html#app-declined" });
    Object.defineProperty(sandbox, "state", { get() { return vm.runInContext("state", sandbox); } });
    await flush();
    const t = sandbox.addTask("Task A", false);
    sandbox.completeTask(sandbox.state.tasks.find((x) => x.id === t.id));
    sandbox.clearCompleted();
    assert.equal(sandbox.state.tasks.length, 1, "declining the confirm() should leave the completed task in place");
  }
});

/* ---------- the new queue-suggestion gate ---------- */

test("benchDone: checking off a QUEUED (dotted) task switches mode to 'work', halting new suggestions", async () => {
  const { ctx } = await loadApp({ seed: 7 });
  ctx.addTask("Task A", true);  // dotted straight onto the chain
  ctx.addTask("Task B", false);
  ctx.addTask("Task C", false);
  assert.equal(ctx.state.mode, "scan");

  ctx.benchDone();
  assert.equal(ctx.state.mode, "work", "completing a chained task should auto-halt suggestions");
});

test("benchDone auto-halt persists even after the chain empties out", async () => {
  const { ctx } = await loadApp({ seed: 8 });
  ctx.addTask("Only queued task", true);
  ctx.benchDone();
  assert.equal(ctx.state.chain.length, 0);
  assert.equal(ctx.state.mode, "work", "finishing your last queued item shouldn't immediately resume suggesting");
});

test("cand-done does NOT trigger the auto-halt — it's still suggestion-list activity, not queue activity", async () => {
  const { ctx } = await loadApp({ seed: 9 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.decide("cand-done");
  assert.equal(ctx.state.mode, "scan");
});

test("ensureCandidate offers nothing new while mode is 'work', even with an eligible pool", async () => {
  const { ctx } = await loadApp({ seed: 10 });
  ctx.addTask("Task A", true);
  ctx.addTask("Task B", false); // stays eligible in the pool
  ctx.benchDone(); // mode -> "work"
  ctx.state.candidateId = null; // simulate "nothing currently offered"
  ctx.ensureCandidate();
  assert.equal(ctx.state.candidateId, null, "no candidate should be surfaced while suggestions are halted");
});

test("the manual 'done adding for now' action (data-act=start-working) halts suggestions the same way", async () => {
  const { ctx } = await loadApp({ seed: 11 });
  ctx.addTask("Task A", true);
  ctx.addTask("Task B", false);
  assert.equal(ctx.state.mode, "scan");
  ctx.onAction("start-working", {});
  assert.equal(ctx.state.mode, "work");
});

test("resume-scan flips back to 'scan' and suggestions resume", async () => {
  const { ctx } = await loadApp({ seed: 12 });
  ctx.addTask("Task A", true);
  ctx.addTask("Task B", false);
  ctx.benchDone();
  assert.equal(ctx.state.mode, "work");
  ctx.onAction("resume-scan", {});
  assert.equal(ctx.state.mode, "scan");
  ctx.ensureCandidate();
  assert.ok(ctx.state.candidateId, "a candidate should be offered again after resuming");
});

test("UI: the 'done adding for now' button only renders while mode is 'scan' AND something is dotted", async () => {
  const { ctx, shim } = await loadApp({ seed: 13 });
  // nothing dotted yet — no benchmark card at all, so the button cannot appear
  ctx.addTask("Task A", false);
  ctx.render();
  assert.ok(!shim.elements.get("scan").innerHTML.includes("done adding for now"));

  // dot something — button should now appear (mode is still "scan")
  ctx.addTask("Task B", true);
  ctx.render();
  assert.ok(shim.elements.get("scan").innerHTML.includes("done adding for now"));

  // halt suggestions — button should disappear (nothing left to "stop")
  ctx.benchDone();
  ctx.render();
  assert.ok(!shim.elements.get("scan").innerHTML.includes("done adding for now"));
});


test("esc: escapes all five HTML-significant characters, and null/undefined become empty string", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.esc(`<b>&"'`), "&lt;b&gt;&amp;&quot;&#39;");
  assert.equal(ctx.esc(null), "");
  assert.equal(ctx.esc(undefined), "");
});

test("safeUrl: allows http(s) and mailto, blocks javascript: and other schemes and control chars", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.safeUrl("https://example.com"), "https://example.com");
  assert.equal(ctx.safeUrl("http://example.com"), "http://example.com");
  assert.equal(ctx.safeUrl("mailto:a@b.com"), "mailto:a@b.com");
  assert.equal(ctx.safeUrl("javascript:alert(1)"), null);
  assert.equal(ctx.safeUrl("data:text/html,x"), null);
  assert.equal(ctx.safeUrl("vbscript:msgbox(1)"), null);
  assert.equal(ctx.safeUrl("//example.com/x"), "https://example.com/x");
  assert.equal(ctx.safeUrl("not a url"), null);
  assert.equal(ctx.safeUrl(""), null);
  assert.equal(ctx.safeUrl("java\u0000script:alert(1)"), null, "control chars used to smuggle a scheme must be rejected");
});

test("parseTaskList: numbered, bulleted, checkbox, heading, hr, and markdown-link lines", async () => {
  const { ctx } = await loadApp();
  const input = [
    "1. First task",
    "2) Second task",
    "- Third task",
    "* Fourth task",
    "\u2022 Fifth task",
    "- [x] already done, should be skipped",
    "# a heading, should be skipped",
    "---",
    "[Renew the tag](https://example.com/tag)",
    "https://example.com/bare Bare url task",
  ].join("\n");
  const rows = ctx.parseTaskList(input);
  const titles = rows.map((r) => r.title);
  assert.ok(titles.includes("First task"));
  assert.ok(titles.includes("Second task"));
  assert.ok(titles.includes("Third task"));
  assert.ok(titles.includes("Fourth task"));
  assert.ok(titles.includes("Fifth task"));
  assert.ok(!titles.some((t) => t.includes("already done")), "checked checkbox lines should be skipped");
  assert.ok(!titles.some((t) => t.includes("heading")), "headings should be skipped");
  const link = rows.find((r) => r.title.includes("Renew the tag"));
  assert.equal(link.url, "https://example.com/tag");
  const bare = rows.find((r) => r.title === "Bare url task");
  assert.equal(bare.url, "https://example.com/bare");
});

test("parseTaskList: a javascript: URL inside a markdown link is stripped by safeUrl", async () => {
  const { ctx } = await loadApp();
  const rows = ctx.parseTaskList("[Click me](javascript:alert(1))");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, null);
});

test("todayISO / sameLocalDay: offsets and day-boundary comparisons", async () => {
  const { ctx } = await loadApp();
  const today = ctx.todayISO(0);
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const now = Date.now();
  assert.equal(ctx.sameLocalDay(now, now), true);
  assert.equal(ctx.sameLocalDay(now - 25 * 3600 * 1000 * 2, now), false);
  assert.equal(ctx.sameLocalDay(null, now), false);
});

test("dueInfo: classifies overdue / today / tomorrow / later", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.dueInfo(null), null);
  assert.equal(ctx.dueInfo(ctx.todayISO(-1)).cls, "due-overdue");
  assert.equal(ctx.dueInfo(ctx.todayISO(0)).cls, "due-today");
  assert.equal(ctx.dueInfo(ctx.todayISO(1)).cls, "due-tomorrow");
  assert.equal(ctx.dueInfo(ctx.todayISO(5)).cls, "due-later");
});

test("fmtWhen: today / yesterday / this-week / older labels", async () => {
  const { ctx } = await loadApp();
  const now = Date.now();
  assert.equal(ctx.fmtWhen(now), "today");
  assert.equal(ctx.fmtWhen(now - 24 * 3600 * 1000), "yesterday");
  assert.equal(ctx.fmtWhen(null), "");
});



test("smoke: engine extracts and phi/Phi behave like a real CDF", () => {
  const E = loadEngine();
  assert.ok(Math.abs(E.Phi(0) - 0.5) < 0.01, "Phi(0) should be ~0.5");
  assert.ok(E.Phi(-10) < 0.001, "Phi(-10) should be ~0");
  assert.ok(E.Phi(10) > 0.999, "Phi(10) should be ~1");
});

test("Phi is monotonically increasing", () => {
  const E = loadEngine();
  const xs = [-5, -2, -1, -0.5, 0, 0.5, 1, 2, 5];
  for (let i = 1; i < xs.length; i++) {
    assert.ok(E.Phi(xs[i]) >= E.Phi(xs[i - 1]), `Phi(${xs[i]}) should be >= Phi(${xs[i - 1]})`);
  }
});

test("pBeats and pJudged are complementary under swap (proper CDF symmetry)", () => {
  const E = loadEngine();
  const a = { mu: 30, sigma: 5 }, b = { mu: 22, sigma: 6 };
  assert.ok(Math.abs(E.pBeats(a, b) + E.pBeats(b, a) - 1) < 1e-9);
  assert.ok(Math.abs(E.pJudged(a, b) + E.pJudged(b, a) - 1) < 1e-9);
});

test("pJudged is exactly 0.5 for identical strengths", () => {
  const E = loadEngine();
  const a = { mu: 25, sigma: 8 }, b = { mu: 25, sigma: 8 };
  assert.ok(Math.abs(E.pJudged(a, b) - 0.5) < 1e-9);
});

test("updatePair: winner's mu rises, loser's mu falls", () => {
  const E = loadEngine();
  const winner = { mu: 25, sigma: 25 / 3 };
  const loser = { mu: 25, sigma: 25 / 3 };
  E.updatePair(winner, loser);
  assert.ok(winner.mu > 25, "winner mu should increase");
  assert.ok(loser.mu < 25, "loser mu should decrease");
});

test("updatePair: sigma never drops below SIGMA_FLOOR, even after many updates", () => {
  const E = loadEngine();
  const floor = readConst(E, "SIGMA_FLOOR");
  const a = { mu: 25, sigma: 25 / 3 };
  const b = { mu: 20, sigma: 25 / 3 };
  for (let i = 0; i < 200; i++) E.updatePair(a, b);
  assert.ok(a.sigma >= floor - 1e-9);
  assert.ok(b.sigma >= floor - 1e-9);
});

test("rankStats: single item always ranks 1st with full probability mass", () => {
  const E = loadEngine(1);
  const stats = E.rankStats([{ id: "only", mu: 25, sigma: 5 }], 200);
  const st = stats.get("only");
  assert.equal(st.topK, 1);
  assert.ok(Math.abs(st.hist[0] - 1) < 1e-6);
});

test("rankStats: a dominant item (huge mu, tiny sigma) wins rank 1 almost always", () => {
  const E = loadEngine(42);
  const items = [
    { id: "dominant", mu: 1000, sigma: 0.1 },
    { id: "weak1", mu: 25, sigma: 8 },
    { id: "weak2", mu: 20, sigma: 8 },
    { id: "weak3", mu: 15, sigma: 8 },
  ];
  const stats = E.rankStats(items, 500);
  const dom = stats.get("dominant");
  assert.ok(dom.hist[0] > 0.98, `expected dominant item to hold rank 1 nearly always, got P(rank=1)=${dom.hist[0]}`);
  // topK is defined (see the ENGINE comment) as the smallest K >= 2 with P(rank<=K) >= 1-1/K —
  // it never checks K=1 by construction, so 2 is the best a dominant item can score, not 1.
  assert.equal(dom.topK, 2);
});

test("rankStats: probability mass sums to 1 per item and topK is within bounds", () => {
  const E = loadEngine(7);
  const items = [
    { id: "a", mu: 30, sigma: 5 }, { id: "b", mu: 25, sigma: 6 },
    { id: "c", mu: 20, sigma: 7 }, { id: "d", mu: 15, sigma: 8 },
  ];
  const stats = E.rankStats(items, 300);
  for (const it of items) {
    const st = stats.get(it.id);
    const sum = st.hist.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `hist for ${it.id} should sum to 1, got ${sum}`);
    assert.ok(st.topK >= 1 && st.topK <= items.length);
  }
});

test("thompsonPick: empty pool returns null, single-item pool returns that item", () => {
  const E = loadEngine(3);
  assert.equal(E.thompsonPick([]), null);
  const only = { id: "x", mu: 10, sigma: 2 };
  assert.equal(E.thompsonPick([only]), only);
});

test("thompsonPick: a low-variance, much-stronger item is picked in the large majority of draws", () => {
  const E = loadEngine(99);
  const strong = { id: "strong", mu: 500, sigma: 0.5 };
  const weak = { id: "weak", mu: 25, sigma: 8 };
  let strongCount = 0;
  const trials = 500;
  for (let i = 0; i < trials; i++) {
    if (E.thompsonPick([strong, weak]).id === "strong") strongCount++;
  }
  assert.ok(strongCount / trials > 0.95, `expected the dominant item picked >95% of the time, got ${strongCount}/${trials}`);
});

test("chanceBetterSoon: empty pool is always 0", () => {
  const E = loadEngine();
  assert.equal(E.chanceBetterSoon({ mu: 25, sigma: 5 }, [], 5), 0);
});

test("chanceBetterSoon: exactly 0.5 for one equal-strength candidate (deterministic, no RNG involved)", () => {
  const E = loadEngine();
  const bench = { mu: 25, sigma: 8 };
  const pool = [{ mu: 25, sigma: 8 }];
  const chance = E.chanceBetterSoon(bench, pool, 1);
  assert.ok(Math.abs(chance - 0.5) < 1e-9, `expected exactly 0.5, got ${chance}`);
});

test("chanceBetterSoon: rises toward 1 as the pool has more equally-strong candidates", () => {
  const E = loadEngine();
  const bench = { mu: 25, sigma: 8 };
  const pool3 = [{ mu: 25, sigma: 8 }, { mu: 25, sigma: 8 }, { mu: 25, sigma: 8 }];
  const chance1 = E.chanceBetterSoon(bench, pool3, 1);
  const chance3 = E.chanceBetterSoon(bench, pool3, 3);
  assert.ok(chance3 > chance1, "considering more candidates per minute should raise the chance of finding a better one");
});

test("median: odd, even, and empty arrays", () => {
  const E = loadEngine();
  assert.equal(E.median([3, 1, 2]), 2);
  assert.equal(E.median([1, 2, 3, 4]), 2.5);
  assert.ok(Number.isNaN(E.median([])));
});


/* ---------- regression: the cloud-sync recursion bug fixed last turn ----------
   CS.push/CS.pull each ping() (dispatch "cloudsync") BEFORE their own network
   await — once for "syncing", once for "ok". The old listener called
   cloudPull() directly on every ping, including ones fired *by* cloudPull's
   own call into CS.pull — an unbounded synchronous recursive cascade. This
   fake CloudSync reproduces that exact ping-before-await shape; if the guard
   in cloudPull() ever regresses, this test will hang or crash instead of
   completing with a small, bounded call count. */
function makeFakeCloudSyncFactory({ delayMs = 4 } = {}) {
  const store = { payload: null, updatedAt: 0 };
  return (shimWindow) => {
    const CS = {
      configured: true, ready: true, user: "test@example.com", status: "ok",
      signIn() {}, signOut() {},
      pullCalls: 0,
      async pull() {
        CS.pullCalls++;
        if (CS.pullCalls > 100) throw new Error("runaway recursive pull — the guard regressed");
        CS.status = "syncing";
        shimWindow.dispatchEvent({ type: "cloudsync" }); // ping BEFORE the await, same as the real module
        await new Promise((r) => setTimeout(r, delayMs));
        CS.status = "ok";
        shimWindow.dispatchEvent({ type: "cloudsync" });
        return store.payload ? { payload: store.payload, updatedAt: store.updatedAt } : null;
      },
      async push(payload, updatedAt) {
        CS.status = "syncing";
        shimWindow.dispatchEvent({ type: "cloudsync" });
        await new Promise((r) => setTimeout(r, delayMs));
        store.payload = payload; store.updatedAt = updatedAt;
        CS.status = "ok";
        shimWindow.dispatchEvent({ type: "cloudsync" });
      },
    };
    return CS;
  };
}

test("REGRESSION: dotting a task (immediate cloud sync) does not trigger a runaway recursive pull", async () => {
  const factory = makeFakeCloudSyncFactory({ delayMs: 4 });
  const { ctx } = await loadApp({ seed: 20, cloudSyncFactory: factory });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);

  ctx.decide("can"); // chain-start dot, immediate-sync path (cloudPushNow) — pings before its own await too

  await new Promise((r) => setTimeout(r, 200)); // let every fake network call and its chained pings settle

  assert.equal(ctx.state.chain.length, 1, "the dot itself should have gone through");
});

test("REGRESSION: a focus-triggered pull racing a push settles with a small, bounded number of real network calls", async () => {
  const factory = makeFakeCloudSyncFactory({ delayMs: 4 });
  const trackedCalls = [];
  const wrapped = (shimWindow) => {
    const cs = factory(shimWindow);
    const origPull = cs.pull.bind(cs);
    const origPush = cs.push.bind(cs);
    cs.pull = (...a) => { trackedCalls.push("pull"); return origPull(...a); };
    cs.push = (...a) => { trackedCalls.push("push"); return origPush(...a); };
    return cs;
  };
  const { ctx } = await loadApp({ seed: 21, cloudSyncFactory: wrapped });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);

  ctx.decide("can");         // fires an immediate push (and, via ping, a legitimate pull attempt)
  ctx.cloudPull();           // simulates a focus/visibilitychange-triggered pull landing at the same time

  await new Promise((r) => setTimeout(r, 200));

  // Without the reentrancy guard this would spiral; with it, this settles to
  // a small handful of real calls rather than dozens/hundreds/a crash.
  assert.ok(trackedCalls.length < 10, `expected a bounded number of real network calls, got ${trackedCalls.length}: ${trackedCalls.join(",")}`);
});

/* ---------- regression: sync button must stay a consistent size ----------
   The button has a fixed CSS width (88px) sized for short, similar-length
   labels. This doesn't check pixels (no real layout engine here), but it
   pins the actual label lengths so nobody can silently push a long string
   back into renderSync() without also revisiting the CSS width. */
test("REGRESSION: sync status labels all stay short enough for the fixed-width badge", async () => {
  const { ctx, shim } = await loadApp();
  const CS = { configured: true, ready: true, user: "a@b.com", status: "ok" };
  shim.window.CloudSync = CS;
  const el = shim.elements.get("syncBtn") || (ctx.document ?? shim.document).getElementById("syncBtn");

  const MAX_LEN = 10; // codepoints, cloud glyph included — matches the 88px budget
  for (const status of ["ok", "syncing", "error", "signed-out"]) {
    CS.status = status;
    ctx.renderSync();
    const text = shim.elements.get("syncBtn").textContent;
    assert.ok([...text].length <= MAX_LEN, `"${text}" (status=${status}) is ${[...text].length} chars, over the ${MAX_LEN}-char budget the fixed width assumes`);
  }
});

/* ---------- "can't" is bulletproof for its own configurable duration ----------
   Bug: newPass() (triggered whenever the chain empties, e.g. via benchDone())
   used to wipe state.considered wholesale, silently un-can't-ing everything
   regardless of how recently it was marked. Fix: a can't mark now carries a
   timestamp (state.cantAt) and survives newPass() until state.settings.cantMin
   minutes have actually elapsed; expireCants() then clears it on its own. */

test("cant is timestamped and excludes the task from the pool immediately", async () => {
  const { ctx } = await loadApp({ seed: 30 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  const cand = ctx.state.candidateId;
  ctx.decide("cant");
  assert.equal(ctx.state.considered[cand], "cant");
  assert.ok(typeof ctx.state.cantAt[cand] === "number", "cantAt should record when it was marked");
  assert.notEqual(ctx.state.candidateId, cand, "a can't task should not stay the offered candidate");
});

test("BUG FIX: a fresh can't mark survives the chain emptying out (newPass), regardless of elapsed time being ~0", async () => {
  const { ctx } = await loadApp({ seed: 31 });
  ctx.addTask("Only queued task", true); // dotted — this is what empties the chain
  ctx.addTask("Said can't to this one", false);
  const cantId = ctx.state.candidateId;
  ctx.decide("cant"); // mark can't on Task B — this should now be bulletproof

  ctx.benchDone(); // completes the queued task, chain -> empty -> triggers newPass()

  assert.equal(ctx.state.chain.length, 0);
  assert.equal(ctx.state.considered[cantId], "cant", "the can't mark must survive newPass() while still fresh");
  assert.ok(!ctx.state.tasks.every(t => t.id !== cantId) , "sanity: task still exists");
});

test("a can't mark that has genuinely outlived cantMin IS cleared by newPass()", async () => {
  const { ctx } = await loadApp({ seed: 32 });
  ctx.state.settings.cantMin = 10; // shrink the window so the test doesn't need huge offsets
  ctx.addTask("Only queued task", true);
  ctx.addTask("Old can't", false);
  const cantId = ctx.state.candidateId;

  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.decide("cant");
  assert.equal(ctx.state.considered[cantId], "cant");

  setFakeTime(ctx, t0 + 11 * 60000); // 11 minutes later — past the 10-minute cantMin
  ctx.benchDone(); // -> newPass()

  assert.equal(ctx.state.considered[cantId], undefined, "an expired can't mark should be dropped, not preserved forever");
  assert.equal(ctx.state.cantAt[cantId], undefined, "its timestamp should be cleaned up too");
});

test("a can't mark automatically expires mid-session (no newPass needed) once cantMin elapses", async () => {
  const { ctx } = await loadApp({ seed: 33 });
  ctx.state.settings.cantMin = 15;
  ctx.addTask("Task A", false);
  ctx.addTask("Said can't", false);
  const cantId = ctx.state.candidateId;

  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.decide("cant");
  assert.ok(!ctx.pool().some((t) => t.id === cantId), "should be excluded from the pool right after being marked");

  setFakeTime(ctx, t0 + 5 * 60000); // still within the window
  assert.ok(!ctx.pool().some((t) => t.id === cantId), "still excluded well within cantMin");

  setFakeTime(ctx, t0 + 16 * 60000); // past the window now
  ctx.ensureCandidate(); // any normal app action re-checks expiry, not just newPass
  assert.ok(ctx.pool().some((t) => t.id === cantId), "should rejoin the pool once cantMin has elapsed");
  assert.equal(ctx.state.considered[cantId], undefined);
});

test("changing cantMin immediately affects how much longer an existing can't mark is bulletproof for", async () => {
  const { ctx } = await loadApp({ seed: 34 });
  ctx.state.settings.cantMin = 60;
  ctx.addTask("Task A", false);
  ctx.addTask("Said can't", false);
  const cantId = ctx.state.candidateId;
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.decide("cant");

  setFakeTime(ctx, t0 + 20 * 60000); // 20 min later, well within a 60-min cantMin
  ctx.state.settings.cantMin = 15; // shrink cantMin below the elapsed time
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[cantId], undefined, "shrinking cantMin below elapsed time should expire it on next check");
});

test("rescanSkipped() remains a deliberate manual override — clears can't immediately regardless of the timer", async () => {
  const { ctx } = await loadApp({ seed: 35 });
  ctx.addTask("Task A", false);
  ctx.addTask("Said can't", false);
  const cantId = ctx.state.candidateId;
  ctx.decide("cant"); // freshly marked, nowhere near expiry

  ctx.rescanSkipped();
  assert.equal(ctx.state.considered[cantId], undefined, "an explicit rescan should still override the timer on purpose");
  assert.equal(ctx.state.cantAt[cantId], undefined);
});

test("deleteTask cleans up cantAt too, so no orphaned timestamps linger", async () => {
  const { ctx } = await loadApp({ seed: 36 });
  ctx.addTask("Task A", false);
  ctx.addTask("Said can't", false);
  const cantId = ctx.state.candidateId;
  ctx.decide("cant");
  assert.ok(ctx.state.cantAt[cantId]);
  ctx.deleteTask(cantId);
  assert.equal(ctx.state.cantAt[cantId], undefined);
});

test("UI: the list badge shows remaining cooldown minutes for an active can't mark", async () => {
  const { ctx } = await loadApp({ seed: 37 });
  ctx.state.settings.cantMin = 60;
  ctx.addTask("Task A", false);
  ctx.addTask("Said can't", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.decide("cant");

  setFakeTime(ctx, t0 + 10 * 60000); // 10 minutes in, ~50 left
  ctx.state.listOpen = true;
  ctx.render();
  const listHtml = ctx.document.getElementById("listBody").innerHTML;
  assert.match(listHtml, /class="skipped">can.t \u00b7 50m<\/span>/, `expected a "can't · 50m" badge in: ${listHtml}`);
});

/* ---------- cantMin settings validation ---------- */

function setInput(ctx, id, value) {
  ctx.document.getElementById(id).value = String(value);
}

test("save-settings: cantMin is read, clamped [5,480], and persisted independently of horizonMin", async () => {
  const { ctx } = await loadApp({ seed: 50 });
  setInput(ctx, "stHorizon", 90);
  setInput(ctx, "stCantMin", 12);
  setInput(ctx, "stThresh", 20);
  setInput(ctx, "stSamples", 300);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.horizonMin, 90);
  assert.equal(ctx.state.settings.cantMin, 12);
});

test("save-settings: cantMin below 5 clamps up to 5, above 480 clamps down to 480", async () => {
  const { ctx } = await loadApp({ seed: 51 });
  setInput(ctx, "stHorizon", 60);
  setInput(ctx, "stCantMin", 2); // non-zero (0 is falsy and hits the ||default fallback instead, same as horizonMin)
  setInput(ctx, "stThresh", 25);
  setInput(ctx, "stSamples", 250);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.cantMin, 5);

  setInput(ctx, "stCantMin", 9999);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.cantMin, 480);
});

test("save-settings: a blank/non-numeric cantMin falls back to 30, not to horizonMin's default", async () => {
  const { ctx } = await loadApp({ seed: 52 });
  setInput(ctx, "stHorizon", 60);
  setInput(ctx, "stCantMin", "");
  setInput(ctx, "stThresh", 25);
  setInput(ctx, "stSamples", 250);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.cantMin, 30);
});

test("save-settings: a literal 0 is falsy and falls back to the default rather than clamping to the minimum (shared quirk with horizonMin/thresholdPct)", async () => {
  const { ctx } = await loadApp({ seed: 53 });
  setInput(ctx, "stHorizon", 0);
  setInput(ctx, "stCantMin", 0);
  setInput(ctx, "stThresh", 25);
  setInput(ctx, "stSamples", 250);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.horizonMin, 60, "0 hits the existing ||60 fallback, not Math.max(5,...)");
  assert.equal(ctx.state.settings.cantMin, 30, "0 hits the ||30 fallback the same way, for consistency");
});

/* ---------- quick-add context picker ---------- */

test("quick-add: selecting a context chip tags newly added tasks with it", async () => {
  const { ctx } = await loadApp({ seed: 60 });
  const home = { id: "ctx_home_t", name: "At home", active: true };
  ctx.state.contexts.push(home);

  ctx.onAction("qctx", { dataset: { id: home.id } });
  setInput(ctx, "addInput", "Water the plants");
  ctx.onAction("add", {});

  const t = ctx.state.tasks.find((x) => x.title === "Water the plants");
  assert.ok(t, "task should have been added");
  assert.deepEqual([...t.ctx], [home.id]);
});

test("quick-add: the picked context is sticky across multiple adds, not cleared after one", async () => {
  const { ctx } = await loadApp({ seed: 61 });
  const home = { id: "ctx_home_t2", name: "At home", active: true };
  ctx.state.contexts.push(home);
  ctx.onAction("qctx", { dataset: { id: home.id } });

  setInput(ctx, "addInput", "Task one");
  ctx.onAction("add", {});
  setInput(ctx, "addInput", "Task two");
  ctx.onAction("add", {});

  const t1 = ctx.state.tasks.find((x) => x.title === "Task one");
  const t2 = ctx.state.tasks.find((x) => x.title === "Task two");
  assert.deepEqual([...t1.ctx], [home.id]);
  assert.deepEqual([...t2.ctx], [home.id], "selection should still be active for the second add");
});

test("quick-add: tapping a selected chip again deselects it", async () => {
  const { ctx } = await loadApp({ seed: 62 });
  const home = { id: "ctx_home_t3", name: "At home", active: true };
  ctx.state.contexts.push(home);
  ctx.onAction("qctx", { dataset: { id: home.id } }); // select
  ctx.onAction("qctx", { dataset: { id: home.id } }); // deselect

  setInput(ctx, "addInput", "Untagged task");
  ctx.onAction("add", {});
  const t = ctx.state.tasks.find((x) => x.title === "Untagged task");
  assert.equal(t.ctx.length, 0);
});

test("quick-add: multiple selected chips all apply to the new task", async () => {
  const { ctx } = await loadApp({ seed: 63 });
  const home = { id: "ctx_home_t4", name: "At home", active: true };
  const laptop = { id: "ctx_laptop_t4", name: "At laptop", active: true };
  ctx.state.contexts.push(home, laptop);
  ctx.onAction("qctx", { dataset: { id: home.id } });
  ctx.onAction("qctx", { dataset: { id: laptop.id } });

  setInput(ctx, "addInput", "Multi-context task");
  ctx.onAction("add", {});
  const t = ctx.state.tasks.find((x) => x.title === "Multi-context task");
  assert.equal(t.ctx.length, 2);
  assert.ok(t.ctx.includes(home.id) && t.ctx.includes(laptop.id));
});

test("quick-add: 'Add & dot' also tags with the selected context", async () => {
  const { ctx } = await loadApp({ seed: 64 });
  const home = { id: "ctx_home_t5", name: "At home", active: true };
  ctx.state.contexts.push(home);
  ctx.onAction("qctx", { dataset: { id: home.id } });

  setInput(ctx, "addInput", "Urgent tagged task");
  ctx.onAction("add-dot", {});
  const t = ctx.state.tasks.find((x) => x.title === "Urgent tagged task");
  assert.deepEqual([...t.ctx], [home.id]);
  assert.ok(ctx.state.chain.includes(t.id));
});

test("quick-add: pasting/typing a multi-line list through the bar tags every resulting task", async () => {
  const { ctx } = await loadApp({ seed: 65 });
  const errand = { id: "ctx_errand_t6", name: "Errands", active: true };
  ctx.state.contexts.push(errand);
  ctx.onAction("qctx", { dataset: { id: errand.id } });

  setInput(ctx, "addInput", "1. Buy milk\n2. Return package");
  ctx.onAction("add", {});

  const milk = ctx.state.tasks.find((x) => x.title === "Buy milk");
  const pkg = ctx.state.tasks.find((x) => x.title === "Return package");
  assert.deepEqual([...milk.ctx], [errand.id]);
  assert.deepEqual([...pkg.ctx], [errand.id]);
});

test("quick-add context selection does NOT leak into the separate Settings \u2192 Import flow", async () => {
  const { ctx } = await loadApp({ seed: 66 });
  const home = { id: "ctx_home_t7", name: "At home", active: true };
  ctx.state.contexts.push(home);
  ctx.onAction("qctx", { dataset: { id: home.id } });

  setInput(ctx, "mdImport", "1. From the settings importer");
  ctx.onAction("import-md", {});

  const t = ctx.state.tasks.find((x) => x.title === "From the settings importer");
  assert.ok(t, "task should still be added via the settings importer");
  assert.equal(t.ctx.length, 0, "the settings-modal import must not pick up the quick-add chip selection");
});

test("quick-add: deleting a selected context removes it from the picker without crashing a subsequent add", async () => {
  const { ctx } = await loadApp({ seed: 67 });
  const home = { id: "ctx_home_t8", name: "At home", active: true };
  ctx.state.contexts.push(home);
  ctx.onAction("qctx", { dataset: { id: home.id } });

  ctx.onAction("del-ctx", { dataset: { id: home.id } }); // deletes the context entirely
  ctx.render(); // renderQuickCtx() prunes stale selections against the current context list

  setInput(ctx, "addInput", "Task after context deletion");
  ctx.onAction("add", {});
  const t = ctx.state.tasks.find((x) => x.title === "Task after context deletion");
  assert.ok(t, "add should still work cleanly");
  assert.equal(t.ctx.length, 0, "a deleted context's id should not linger on new tasks");
});

/* ---------- regression: the Done control is a plain checkbox, not a custom circle ----------
   No real layout engine here, so this checks the CSS source directly rather
   than rendered pixels — enough to catch someone silently reintroducing the
   custom appearance:none circular style this was explicitly reverted from. */
test("REGRESSION: .ckbox has no custom appearance override — it renders as a native checkbox", () => {
  const m = html.match(/\.ckbox\{[^}]*\}/);
  assert.ok(m, ".ckbox rule should exist");
  const rule = m[0];
  assert.ok(!/appearance\s*:\s*none/.test(rule), `.ckbox should not override appearance — found in: ${rule}`);
  assert.ok(!/border-radius\s*:\s*50%/.test(rule), `.ckbox should not be forced circular — found in: ${rule}`);
  // no leftover custom :checked pseudo-element rules from the old circular design
  assert.ok(!/\.ckbox:checked::after/.test(html), "custom checked-state pseudo-element should have been removed");
});

/* ---------- audit: "cant" marks missing their start timestamp ----------
   Bug: expireCants()'s expiry check required state.cantAt[id] to be truthy
   before it would even consider expiring an entry. A "cant" mark with no
   timestamp — e.g. one set before cantAt existed, or reintroduced via an
   older JSON import or a cloud sync from a device on an older version —
   would therefore never expire: permanently stuck, exactly the opposite of
   "bulletproof for a bounded duration." Fix: expireCants() now backfills a
   fresh timestamp for any orphaned "cant" it finds, and also sweeps the
   reverse case (a leftover timestamp with no matching "cant" mark). */

test("AUDIT: a pre-existing can't mark with no cantAt timestamp gets one backfilled instead of staying permanently stuck", async () => {
  const { ctx } = await loadApp({ seed: 70 });
  ctx.addTask("Task A", false);
  ctx.addTask("Orphaned can't", false);
  const orphanId = ctx.state.tasks.find((t) => t.title === "Orphaned can't").id;

  // Simulate data from before cantAt existed (or an old JSON import): the
  // "cant" mark is present, but with no matching timestamp.
  ctx.state.considered[orphanId] = "cant";
  assert.equal(ctx.state.cantAt[orphanId], undefined, "sanity: no timestamp yet");

  ctx.ensureCandidate(); // runs expireCants() as its first step
  assert.equal(ctx.state.considered[orphanId], "cant", "should NOT be silently un-cant'd by the audit");
  assert.ok(typeof ctx.state.cantAt[orphanId] === "number", "a fresh timestamp should have been backfilled");
});

test("AUDIT: a backfilled can't mark expires normally afterward, on its own schedule", async () => {
  const { ctx } = await loadApp({ seed: 71 });
  ctx.state.settings.cantMin = 10;
  ctx.addTask("Task A", false);
  ctx.addTask("Orphaned can't", false);
  const orphanId = ctx.state.tasks.find((t) => t.title === "Orphaned can't").id;
  ctx.state.considered[orphanId] = "cant"; // no timestamp — simulating old data

  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.ensureCandidate(); // backfills cantAt[orphanId] = t0
  assert.equal(ctx.state.cantAt[orphanId], t0);

  setFakeTime(ctx, t0 + 5 * 60000); // 5 min later, within the fresh 10-min window
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[orphanId], "cant", "still bulletproof within its freshly-backfilled window");

  setFakeTime(ctx, t0 + 11 * 60000); // past the freshly-backfilled window
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[orphanId], undefined, "should expire normally once its (backfilled) window elapses");
});

test("AUDIT: does not disturb can't marks that already have a valid timestamp", async () => {
  const { ctx } = await loadApp({ seed: 72 });
  ctx.state.settings.cantMin = 60;
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  const cand = ctx.state.candidateId;
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.decide("cant"); // sets considered + cantAt together, normally

  ctx.ensureCandidate(); // audit runs again — should be a no-op for a healthy entry
  assert.equal(ctx.state.cantAt[cand], t0, "an already-correct timestamp should not be overwritten");
});

test("AUDIT (reverse): an orphaned cantAt timestamp with no matching can't mark is cleaned up", async () => {
  const { ctx } = await loadApp({ seed: 73 });
  ctx.addTask("Task A", false);
  const t = ctx.state.tasks[0];
  ctx.state.cantAt[t.id] = Date.now(); // leftover timestamp, no considered["cant"] entry at all

  ctx.ensureCandidate();
  assert.equal(ctx.state.cantAt[t.id], undefined, "an orphaned timestamp with no matching can't mark should be swept");
});

test("AUDIT (reverse): a timestamp left behind after a mark changed to something other than 'cant' is cleaned up", async () => {
  const { ctx } = await loadApp({ seed: 74 });
  ctx.addTask("Task A", false);
  const t = ctx.state.tasks[0];
  ctx.state.considered[t.id] = "no";       // e.g. some other path changed the status
  ctx.state.cantAt[t.id] = Date.now();     // but its old cantAt timestamp was left behind

  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[t.id], "no", "the non-cant status itself should be untouched");
  assert.equal(ctx.state.cantAt[t.id], undefined, "its stale cantAt should be cleaned up since it's no longer a can't");
});

test("AUDIT: repairs multiple orphaned can't marks in a single pass, without disturbing unrelated entries", async () => {
  const { ctx } = await loadApp({ seed: 75 });
  ctx.state.settings.cantMin = 30;
  for (const title of ["A", "B", "C", "D"]) ctx.addTask(title, false);
  const ids = Object.fromEntries(ctx.state.tasks.map((t) => [t.title, t.id]));

  ctx.state.considered[ids.A] = "cant";  // orphaned — no timestamp
  ctx.state.considered[ids.B] = "cant";  // orphaned — no timestamp
  ctx.state.considered[ids.C] = "no";    // healthy, unrelated — should be untouched
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.state.considered[ids.D] = "cant";
  ctx.state.cantAt[ids.D] = t0;          // healthy, already has a timestamp

  ctx.ensureCandidate();

  assert.equal(ctx.state.cantAt[ids.A], t0, "A should be backfilled to the current time");
  assert.equal(ctx.state.cantAt[ids.B], t0, "B should be backfilled to the current time");
  assert.equal(ctx.state.considered[ids.C], "no", "unrelated 'no' entry should be untouched");
  assert.equal(ctx.state.cantAt[ids.C], undefined, "C never had a cantAt and shouldn't get one");
  assert.equal(ctx.state.cantAt[ids.D], t0, "D's existing valid timestamp should be left alone");
});

/* ---------- chain start: oldest-first, can/can't only, no rank signal ----------
   Starting a chain has no benchmark, so a ranked pick and a Yes/No comparison
   are both meaningless. Instead the oldest outstanding task is presented and
   answered Can / Can't (Done and Delete stay available) until one gets dotted;
   that first dot moves no ranks. After that, normal ranked scanning resumes. */

function addTaskAged(ctx, title, ageMs) { // add a task with a backdated createdAt
  const t = ctx.addTask(title, false);
  ctx.state.tasks.find((x) => x.id === t.id).createdAt = Date.now() - ageMs;
  return t;
}
// The shown candidate is deliberately sticky — it won't swap out just because
// another task was added. Force a fresh pick to exercise the selection logic.
function repick(ctx) {
  ctx.state.candidateId = null;
  ctx.ensureCandidate();
}

test("chain start: presents the OLDEST outstanding task, not a ranked pick", async () => {
  const { ctx } = await loadApp({ seed: 80 });
  addTaskAged(ctx, "Newest", 1000);
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Middle", 50000);
  repick(ctx);

  const shown = ctx.state.tasks.find((t) => t.id === ctx.state.candidateId);
  assert.equal(shown.title, "Oldest");
});

test("chain start: a strong rank does NOT jump the queue ahead of the oldest task", async () => {
  const { ctx } = await loadApp({ seed: 81 });
  addTaskAged(ctx, "Oldest but weak", 900000);
  const strong = addTaskAged(ctx, "Newer but top-ranked", 1000);
  const st = ctx.state.tasks.find((t) => t.id === strong.id);
  st.mu = 500; st.sigma = 0.5;   // overwhelmingly the highest-ranked task
  ctx.recomputeRanks();
  ctx.state.candidateId = null;
  ctx.ensureCandidate();

  const shown = ctx.state.tasks.find((t) => t.id === ctx.state.candidateId);
  assert.equal(shown.title, "Oldest but weak", "ranking must not influence the chain-start pick");
});

test("chain start: 'can' dots the task and starts the chain", async () => {
  const { ctx } = await loadApp({ seed: 82 });
  addTaskAged(ctx, "Newer", 1000);          // added first but younger
  addTaskAged(ctx, "Oldest", 900000);
  repick(ctx);
  const first = ctx.state.candidateId;
  assert.equal(ctx.state.tasks.find((t) => t.id === first).title, "Oldest");

  ctx.decide("can");
  assert.equal(ctx.state.chain.length, 1);
  assert.equal(ctx.state.chain[0], first);
});

test("chain start: the first dot moves NO ranks (mu/sigma untouched for every task)", async () => {
  const { ctx } = await loadApp({ seed: 83 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  const before = ctx.state.tasks.map((t) => ({ id: t.id, mu: t.mu, sigma: t.sigma }));

  ctx.decide("can");

  for (const snap of before) {
    const now = ctx.state.tasks.find((t) => t.id === snap.id);
    assert.equal(now.mu, snap.mu, `mu for ${now.title} should be unchanged by the first dot`);
    assert.equal(now.sigma, snap.sigma, `sigma for ${now.title} should be unchanged by the first dot`);
  }
});

test("chain start: 'can't' moves on to the NEXT oldest task", async () => {
  const { ctx } = await loadApp({ seed: 84 });
  addTaskAged(ctx, "Newest", 1000);           // added first, but youngest — must be shown last
  addTaskAged(ctx, "Second oldest", 500000);
  addTaskAged(ctx, "First oldest", 900000);
  repick(ctx);

  assert.equal(ctx.state.tasks.find((t) => t.id === ctx.state.candidateId).title, "First oldest");
  ctx.decide("cant");
  assert.equal(ctx.state.tasks.find((t) => t.id === ctx.state.candidateId).title, "Second oldest");
  ctx.decide("cant");
  assert.equal(ctx.state.tasks.find((t) => t.id === ctx.state.candidateId).title, "Newest");
  assert.equal(ctx.state.chain.length, 0, "saying can't repeatedly should never start a chain");
});

test("chain start: 'yes' and 'no' are rejected outright — no chain change, no considered mark", async () => {
  const { ctx } = await loadApp({ seed: 85 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  const cand = ctx.state.candidateId;

  ctx.decide("yes");
  assert.equal(ctx.state.chain.length, 0, "'yes' must not dot anything at chain start");
  assert.equal(ctx.state.candidateId, cand, "the same task should still be showing");

  ctx.decide("no");
  assert.equal(ctx.state.considered[cand], undefined, "'no' must not mark the task considered at chain start");
  assert.equal(ctx.state.candidateId, cand, "the same task should still be showing");
});

test("chain start: Done still works on the first task and does not start a chain", async () => {
  const { ctx } = await loadApp({ seed: 86 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  const cand = ctx.state.candidateId;

  ctx.decide("cand-done");
  assert.equal(ctx.state.tasks.find((t) => t.id === cand).done, true);
  assert.equal(ctx.state.chain.length, 0);
});

test("chain start: Delete still works on the first task, and the next oldest comes up", async () => {
  const { ctx } = await loadApp({ seed: 87 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Second oldest", 500000);
  const cand = ctx.state.candidateId;

  ctx.deleteTask(cand);
  assert.equal(ctx.state.tasks.some((t) => t.id === cand), false);
  assert.equal(ctx.state.tasks.find((t) => t.id === ctx.state.candidateId).title, "Second oldest");
});

test("after the first dot, scanning hands back to the normal ranked picker", async () => {
  const { ctx } = await loadApp({ seed: 88 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Second oldest", 800000);
  const strong = addTaskAged(ctx, "Newest but top-ranked", 1000);
  const st = ctx.state.tasks.find((t) => t.id === strong.id);
  st.mu = 500; st.sigma = 0.5;
  ctx.recomputeRanks();

  ctx.decide("can"); // dots "Oldest", chain now has a benchmark

  const shown = ctx.state.tasks.find((t) => t.id === ctx.state.candidateId);
  assert.equal(shown.title, "Newest but top-ranked", "ranked picking should resume once a benchmark exists");
});

test("emptying the chain returns to oldest-first chain-start behavior", async () => {
  const { ctx } = await loadApp({ seed: 89 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Second oldest", 800000);
  const strong = addTaskAged(ctx, "Newest but top-ranked", 1000);
  const st = ctx.state.tasks.find((t) => t.id === strong.id);
  st.mu = 500; st.sigma = 0.5;
  ctx.recomputeRanks();

  ctx.decide("can");   // dots "Oldest"
  ctx.benchDone();     // completes it, chain empties, mode -> "work"
  ctx.onAction("resume-scan", {});
  assert.equal(ctx.state.chain.length, 0);

  const shown = ctx.state.tasks.find((t) => t.id === ctx.state.candidateId);
  assert.equal(shown.title, "Second oldest", "back to oldest-first now that the chain is empty again");
});

test("UI: chain start shows Can / Can't but NOT Yes / No", async () => {
  const { ctx, shim } = await loadApp({ seed: 90 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.match(scanHtml, /data-act="can"/, "the Can button should be present at chain start");
  assert.match(scanHtml, /data-act="cant"/, "the Can't button should be present at chain start");
  assert.ok(!/data-act="yes"/.test(scanHtml), "Yes must not be offered at chain start");
  assert.ok(!/data-act="no"/.test(scanHtml), "No must not be offered at chain start");
  assert.match(scanHtml, /data-act="cand-done"/, "Done should still be available");
  assert.match(scanHtml, /data-act="delete-task"/, "Delete should still be available");
});

test("UI: once a chain exists, Yes / No come back and the bare Can button goes away", async () => {
  const { ctx, shim } = await loadApp({ seed: 91 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  addTaskAged(ctx, "Third", 500);
  ctx.decide("can");
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.match(scanHtml, /data-act="yes"/, "Yes should be offered once there's a benchmark");
  assert.match(scanHtml, /data-act="no"/, "No should be offered once there's a benchmark");
  assert.ok(!/data-act="can"[^t]/.test(scanHtml), "the chain-start Can button should be gone");
});
