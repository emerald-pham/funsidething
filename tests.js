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
    // Attributes are really stored now (they used to be no-op stubs) so that
    // <html data-theme="..."> can be asserted on. getAttribute still returns
    // null for anything never set, which is what the old stub always did.
    _attrs: new Map(),
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    removeAttribute(k) { this._attrs.delete(k); },
    hasAttribute(k) { return this._attrs.has(k); },
    appendChild() {}, scrollIntoView() {},
  };
  return el;
}

function makeDomShim({ prefersDark = false } = {}) {
  const elements = new Map();
  const winListeners = {};
  const localStorageMap = new Map();

  const documentElement = makeFakeElement();

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
    documentElement,
  };
  const localStorage = {
    getItem(k) { return localStorageMap.has(k) ? localStorageMap.get(k) : null; },
    setItem(k, v) { localStorageMap.set(k, String(v)); },
    removeItem(k) { localStorageMap.delete(k); },
  };
  // A minimal MediaQueryList good enough for prefers-color-scheme. `setDark`
  // flips the OS preference and notifies listeners the way a real browser does
  // when you change the system appearance while the page is open.
  const mqlListeners = [];
  const mql = {
    media: "(prefers-color-scheme: dark)",
    matches: prefersDark,
    addEventListener(evt, fn) { if (evt === "change") mqlListeners.push(fn); },
    removeEventListener(evt, fn) {
      const i = mqlListeners.indexOf(fn);
      if (i >= 0) mqlListeners.splice(i, 1);
    },
  };
  function setDark(v) {
    mql.matches = !!v;
    for (const fn of [...mqlListeners]) fn({ matches: mql.matches, media: mql.media });
  }

  const window = {
    addEventListener(evt, fn) { (winListeners[evt] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(evt) {
      for (const fn of (winListeners[evt.type] || [])) fn(evt);
      return true;
    },
    matchMedia(q) {
      // Only the color-scheme query is modelled; anything else reports no match.
      if (String(q).includes("prefers-color-scheme: dark")) return mql;
      return { media: String(q), matches: false, addEventListener() {}, removeEventListener() {} };
    },
    localStorage,
    CloudSync: undefined,
  };
  window.window = window;
  return { document, window, localStorage, elements, winListeners, documentElement, setDark, mqlListeners };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function loadApp({ seed, cloudSyncFactory, prefersDark = false, noMatchMedia = false, seedStorage } = {}) {
  const shim = makeDomShim({ prefersDark });
  if (noMatchMedia) delete shim.window.matchMedia;   // old browser / bare JS host
  if (seedStorage) for (const [k, v] of Object.entries(seedStorage)) shim.localStorage.setItem(k, v);
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

test("addTask: new tasks default startsAt to null", async () => {
  const { ctx } = await loadApp();
  const t = ctx.addTask("Task A", false);
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).startsAt, null);
});

test("importList: new tasks default startsAt to null", async () => {
  const { ctx } = await loadApp();
  ctx.importList("1. Task A");
  assert.equal(ctx.state.tasks[0].startsAt, null);
});

test("decide('yes'): dots the candidate, clears it, and a new candidate is picked from the remaining pool", async () => {
  const { ctx } = await loadApp({ seed: 1 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.addTask("Task C", false);
  ctx.startScan();              // dots Task A; yes/no need a benchmark to compare against
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
  ctx.startScan();              // establish a benchmark so 'no' is a valid comparison
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
  ctx.startScan();              // dots Task A, so Task B comes up as the candidate
  const cand = ctx.state.candidateId;
  ctx.decide("cand-done");
  const task = ctx.state.tasks.find((t) => t.id === cand);
  assert.equal(task.done, true);
  assert.ok(!ctx.state.chain.includes(cand), "cand-done must not add the task to the chain");
  assert.equal(ctx.state.chain.length, 1, "the task dotted at the start is the only thing on it");
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
  ctx.startScan();                // dots A; B comes up as the candidate
  assert.equal(ctx.state.chain.length, 1);
  ctx.decide("yes");
  assert.equal(ctx.state.chain.length, 2);
  ctx.undo();
  assert.equal(ctx.state.chain.length, 1);
});

/* ---------- undo has to be durable, not just visible ----------
   undo() restored the snapshot on screen but called commit(false), which skips
   save() — so the reverted state never reached storage. Since save() is
   debounced, any undo more than ~350ms after the action it reverses left the
   pre-undo state on disk, and a reload resurrected whatever you just took back.
   save() also stamps updatedAt, which is what arbitrates the cloud's
   last-write-wins: an undo carrying its snapshot's stale timestamp loses the
   next reconcile to the remote copy it was meant to overrule. */

const SAVE_DEBOUNCE_MS = 350;
const settle = () => new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 120));
const persisted = (shim) => JSON.parse(shim.localStorage.getItem("fvp:chain-scanner:v1"));

test("undo: writes the restored state to storage, so a reload doesn't resurrect it", async () => {
  const { ctx, shim } = await loadApp({ seed: 40 });
  const t = ctx.addTask("Task A", false);
  ctx.doneTask(t.id);
  await settle();
  assert.deepEqual(persisted(shim).tasks.filter((x) => x.done).map((x) => x.title), ["Task A"],
    "precondition: the completion reached storage before the undo");

  ctx.undo();
  await settle();
  assert.deepEqual(persisted(shim).tasks.filter((x) => x.done), [],
    "the undone completion must not still be on disk");
  assert.equal(persisted(shim).tasks.find((x) => x.id === t.id).done, false);
});

test("undo: stamps updatedAt so the restored state outranks the copy it reverses", async () => {
  const { ctx } = await loadApp({ seed: 41 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.startScan();
  const stale = ctx.state.updatedAt;
  ctx.decide("yes");
  await settle();

  ctx.undo();
  assert.ok(ctx.state.updatedAt > stale,
    "an undo is itself a write — a snapshot's old timestamp would lose the next cloud reconcile");
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

/* ---------- start date: a future-dated task can't enter the queue ----------
   A task can carry a startsAt (ISO date, same shape as due). Until that date
   occurs, it's excluded from the pool/candidate scan — so "Can"/"Yes" can
   never dot it into the chain — but every other function (edit, delete,
   Done from the edit pane) still works on it normally. */

test("isEligible: a task with a future startsAt is ineligible", async () => {
  const { ctx } = await loadApp({ seed: 300 });
  const t = ctx.addTask("Future task", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.startsAt = ctx.todayISO(3);
  assert.equal(ctx.isEligible(task, ctx.activeCtxSet()), false);
});

test("isEligible: a task whose startsAt is today is eligible — the start date has occurred", async () => {
  const { ctx } = await loadApp({ seed: 301 });
  const t = ctx.addTask("Starts today", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.startsAt = ctx.todayISO(0);
  assert.equal(ctx.isEligible(task, ctx.activeCtxSet()), true);
});

test("isEligible: a task whose startsAt is in the past is eligible", async () => {
  const { ctx } = await loadApp({ seed: 302 });
  const t = ctx.addTask("Started already", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.startsAt = ctx.todayISO(-5);
  assert.equal(ctx.isEligible(task, ctx.activeCtxSet()), true);
});

test("isEligible: no startsAt at all leaves eligibility untouched (back-compat with saved tasks)", async () => {
  const { ctx } = await loadApp({ seed: 303 });
  const t = ctx.addTask("No start date", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.startsAt, null, "precondition: new tasks default startsAt to null");
  assert.equal(ctx.isEligible(task, ctx.activeCtxSet()), true);
});

test("a future-start task is excluded from the pool and can never be dotted into the chain", async () => {
  const { ctx } = await loadApp({ seed: 304 });
  const soon = ctx.addTask("Ready now", false);
  const future = ctx.addTask("Starts next week", false);
  ctx.state.tasks.find((x) => x.id === future.id).startsAt = ctx.todayISO(7);

  const poolIds = [...ctx.pool()].map((x) => x.id);
  assert.deepEqual(poolIds, [soon.id], "the future-start task must be excluded from the pool");

  ctx.startScan();
  assert.deepEqual([...ctx.state.chain], [soon.id], "the scan starts on the only eligible task");
  assert.equal(ctx.state.chain.includes(future.id), false, "the future-start task must never enter the chain");
});

test("doneTask: completes a future-start task directly from the edit pane, bypassing the queue gate", async () => {
  const { ctx } = await loadApp({ seed: 313 });
  const t = ctx.addTask("Future task", false);
  ctx.state.tasks.find((x) => x.id === t.id).startsAt = ctx.todayISO(10);
  ctx.doneTask(t.id);
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, true, "Done must still work regardless of startsAt");
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
  ctx.onAction("start-working", {});   // pause with Task A still dotted
  assert.equal(ctx.state.mode, "work");
  ctx.onAction("resume-scan", {});
  assert.equal(ctx.state.mode, "scan");
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

test("UI: 'done adding for now' is now a dedicated button in the decide row, not a text link in the siderail", async () => {
  const { ctx, shim } = await loadApp({ seed: 14 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", true); // dots Task B; Task A becomes the candidate, so the decide row shows
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.ok(!/class="sidesm" data-act="start-working"/.test(scanHtml),
    "the old dotted-underline text-link styling should be gone");

  const rails = scanHtml.match(/<div class="siderail[^"]*">[\s\S]*?<\/div>/g) || [];
  for (const rail of rails) {
    assert.ok(!rail.includes('data-act="start-working"'), `siderail should no longer carry the button: ${rail}`);
  }

  const decideRows = scanHtml.match(/<div class="decide">[\s\S]*?<\/div>/g) || [];
  assert.equal(decideRows.length, 1, `expected one decide row, found ${decideRows.length}`);
  assert.match(decideRows[0], /<button class="btn subtle" data-act="start-working"[^>]*>done adding for now<\/button>/,
    "should render as a real button beside Can't, like Yes/No/Can't's siblings");
});

test("UI: 'done adding for now' stays hidden once the pool is empty, even mid-scan with a benchmark dotted", async () => {
  const { ctx, shim } = await loadApp({ seed: 15 });
  ctx.addTask("Only task", true); // sole task, dotted — becomes the benchmark; pool is now empty, so no decide row
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.equal(ctx.state.mode, "scan");
  assert.ok(!scanHtml.includes("done adding for now"),
    "nothing left to suggest, and the button now only appears beside an actual candidate decision");
});

test("UI: 'done adding for now' shows from the first decision — Start scanning already dotted something", async () => {
  const { ctx, shim } = await loadApp({ seed: 16 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.startScan();             // dots Task A, Task B comes up as the candidate
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.equal(ctx.state.chain.length, 1, "sanity check: a chain is under way");
  assert.ok(scanHtml.includes("done adding for now"),
    "there is a dotted task to go work on, so the button has something to mean");
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

test("todayISO: renders an ISO date and honours day offsets", async () => {
  const { ctx } = await loadApp();
  assert.match(ctx.todayISO(0), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(ctx.todayISO(1), /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(ctx.todayISO(1), ctx.todayISO(0));
  assert.notEqual(ctx.todayISO(-1), ctx.todayISO(0));
});

// sameLocalDay() went out with "repeats daily" — the daily eligibility gate was
// its only caller. This guards against it drifting back in unused.
test("sameLocalDay: removed along with the daily recurrence it existed for", async () => {
  const { ctx } = await loadApp();
  assert.equal(typeof ctx.sameLocalDay, "undefined");
});

test("dueInfo: classifies overdue / today / tomorrow / later", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.dueInfo(null), null);
  assert.equal(ctx.dueInfo(ctx.todayISO(-1)).cls, "due-overdue");
  assert.equal(ctx.dueInfo(ctx.todayISO(0)).cls, "due-today");
  assert.equal(ctx.dueInfo(ctx.todayISO(1)).cls, "due-tomorrow");
  assert.equal(ctx.dueInfo(ctx.todayISO(5)).cls, "due-later");
});

test("chipHTML: shows a 'not started' chip while startsAt is in the future", async () => {
  const { ctx } = await loadApp({ seed: 305 });
  const t = ctx.addTask("Future task", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.startsAt = ctx.todayISO(4);
  assert.match(ctx.chipHTML(task), /not started/i);
});

test("chipHTML: no 'not started' chip once the start date has arrived", async () => {
  const { ctx } = await loadApp({ seed: 306 });
  const t = ctx.addTask("Starts today", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.startsAt = ctx.todayISO(0);
  assert.doesNotMatch(ctx.chipHTML(task), /not started/i);
});

test("chipHTML: no 'not started' chip when startsAt is unset", async () => {
  const { ctx } = await loadApp({ seed: 307 });
  const t = ctx.addTask("No start date", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.doesNotMatch(ctx.chipHTML(task), /not started/i);
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
  ctx.startScan();

  ctx.decide("yes"); // dotting takes the immediate-sync path (cloudPushNow) — which pings before its own await too

  await new Promise((r) => setTimeout(r, 200)); // let every fake network call and its chained pings settle

  assert.equal(ctx.state.chain.length, 2, "the dot itself should have gone through");
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
  ctx.startScan();

  ctx.decide("yes");         // fires an immediate push (and, via ping, a legitimate pull attempt)
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
  ctx.startScan();
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
  ctx.startScan();               // dots Task A, so "Said can't" is the one on offer
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
  ctx.startScan();               // dots Task A, so "Said can't" is the one on offer
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
  ctx.startScan();               // dots Task A, so "Said can't" is the one on offer
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
  ctx.startScan();               // dots Task A, so "Said can't" is the one on offer
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
  ctx.startScan();               // dots Task A, so "Said can't" is the one on offer
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

/* ---------- "Add & dot" hides once a chain is active ----------
   Rule 8 urgency (dotting straight from the quick-add bar) only makes sense
   before a chain exists — once one's running, cutting a new task onto the
   TOP of it from the add bar bypasses the scan/compare flow entirely. Plain
   "Add" (into the pool) stays available regardless. */

test("Add & dot is visible when no chain is active", async () => {
  const { ctx, shim } = await loadApp({ seed: 66 });
  assert.equal(ctx.state.chain.length, 0, "precondition: no chain yet");
  assert.equal(shim.elements.get("addDotBtn").hidden, false);
});

test("Add & dot hides once a chain is active", async () => {
  const { ctx, shim } = await loadApp({ seed: 67 });
  ctx.addTask("Task A", true); // dots it, starting the chain
  assert.ok(ctx.state.chain.length > 0, "precondition: chain is active");
  assert.equal(shim.elements.get("addDotBtn").hidden, true);
});

test("Add & dot reappears once the chain empties back out", async () => {
  const { ctx, shim } = await loadApp({ seed: 68 });
  const t = ctx.addTask("Task A", true);
  assert.equal(shim.elements.get("addDotBtn").hidden, true, "precondition: hidden while chained");

  ctx.doneTask(t.id); // completing the only dot empties the chain
  assert.equal(ctx.state.chain.length, 0);
  assert.equal(shim.elements.get("addDotBtn").hidden, false);
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

/* ---------- the Done control is a button in the siderail ----------
   It used to be a checkbox sitting inside the card, on the left, which made
   the app's single most-used action look unlike every other action and put it
   nowhere near them. It's now a green button in the siderail with the rest.
   The old ".ckbox is a native checkbox, not a custom circle" regression guard
   retired with the checkbox — what replaces it is the guarantee that the
   control stays a plain button and the dead styles don't drift back. */
test("the retired card-checkbox styles are gone from the CSS", () => {
  for (const dead of [".ckbox", ".donepick", ".editlink"]) {
    assert.ok(!new RegExp(`\\${dead}\\{`).test(html),
      `${dead} is no longer used by any markup — its rule should have gone with it`);
  }
  assert.ok(!/\.ckbox:checked::after/.test(html), "no leftover checked-state pseudo-element");
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
  ctx.startScan();
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

/* =====================================================================
   "WORKED ON IT" IS BULLETPROOF FOR A CONFIGURABLE WINDOW
   Forster rule 7 crosses a task off and sends it to the bottom of the list.
   Until now the "worked" mark it left behind never expired on its own — the
   task stayed out of the scan until a new pass, a rescan, or Return as
   candidate cleared it by hand. Now the mark carries a timestamp
   (state.workedAt), survives newPass() while fresh, and expireWorked()
   clears it once state.settings.workedHours have elapsed OR the local clock
   crosses 02:00, whichever comes first. It is the hours-scale sibling of the
   "can't" window (cantMin / cantAt / expireCants).
   ===================================================================== */

const WH_STORE_KEY = "fvp:chain-scanner:v1";
const preChangeState = (over = {}) => Object.assign({
  v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, candidateId: null,
  interventionActive: false, interventionP: 0, snooze: 0, mode: "scan", decisionsMs: [],
  presentedAt: 0, listOpen: false, ctxOpen: true, histOpen: false, updatedAt: 0, workLog: [],
  seenQuickStart: true,
  settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, theme: "system" },
}, over);

/* ---- default & migration ---- */

test("workedHours: a fresh state defaults the window to 16 hours", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.state.settings.workedHours, 16,
    "8 was shorter than a waking day, so a task worked at breakfast came back that evening");
});

test("workedHours: a state saved before the window existed migrates to 16 on boot", async () => {
  const stored = preChangeState();                       // settings has no workedHours key
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });
  assert.equal(ctx.state.settings.workedHours, 16);
});

test("workedHours: a state still sitting on the old 8h default is carried up to 16", async () => {
  const stored = preChangeState({ v: 1, settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, workedHours: 8, theme: "system" } });
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });
  assert.equal(ctx.state.settings.workedHours, 16, "the old default moves with the new one");
  assert.equal(ctx.state.v, 2, "and the migration is stamped so it only happens once");
});

test("workedHours: a window the user picked themselves is never overwritten by the migration", async () => {
  const stored = preChangeState({ v: 1, settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, workedHours: 30, theme: "system" } });
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });
  assert.equal(ctx.state.settings.workedHours, 30);
});

test("REGRESSION: a partial settings object from another device is filled in, not left with holes", async () => {
  // Reachable from an older device or a hand-edited import: settings exists, so
  // the old guard skipped it, and horizonMin/thresholdPct/samples stayed
  // undefined — which turned the scan arithmetic into NaN instead of failing.
  const stored = preChangeState({ settings: { cantMin: 45 } });
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });
  const s = ctx.state.settings;
  assert.equal(s.cantMin, 45, "what the other device did set is kept");
  for (const k of ["horizonMin", "thresholdPct", "samples", "workedHours"]) {
    assert.ok(Number.isFinite(s[k]), `${k} must be a real number, got ${s[k]}`);
  }
  assert.equal(s.theme, "system");
  assert.match(ctx.untilClock(), /^\d+:\d\d [AP]M$/, `the horizon clock must not read NaN: ${ctx.untilClock()}`);
});

test("REGRESSION: junk in a synced setting falls back to the default rather than propagating", async () => {
  const stored = preChangeState({ settings: { horizonMin: "sixty", thresholdPct: null, samples: NaN, cantMin: 30, workedHours: 16, theme: "system" } });
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });
  assert.equal(ctx.state.settings.horizonMin, 60);
  assert.equal(ctx.state.settings.thresholdPct, 25);
  assert.equal(ctx.state.settings.samples, 250);
});

test("workedAt: a state saved without the workedAt map gets an empty one on boot, no crash", async () => {
  const stored = preChangeState();                       // no workedAt key at all
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });
  assert.ok(ctx.state.workedAt && typeof ctx.state.workedAt === "object", "the map must exist");
  assert.equal(Object.keys(ctx.state.workedAt).length, 0, "and start empty");
});

test("cloudPull: adopting a remote state from an older version backfills workedHours and workedAt", async () => {
  const remoteState = preChangeState({ updatedAt: Date.now() + 100000 });
  const { ctx } = await loadApp({
    cloudSyncFactory: () => ({
      configured: true, ready: true, user: "e@example.com", status: "on",
      signIn() {}, signOut() {},
      async pull() { return { updatedAt: remoteState.updatedAt, payload: JSON.stringify(remoteState) }; },
      async push() {},
    }),
  });
  await ctx.cloudPull();
  assert.equal(ctx.state.settings.workedHours, 16, "the window setting must exist after adoption");
  assert.ok(ctx.state.workedAt && typeof ctx.state.workedAt === "object", "the timestamp map must exist after adoption");
  assert.equal(Object.keys(ctx.state.workedAt).length, 0, "and start empty");
});

test("import-json: importing an export taken before this change backfills workedHours/workedAt and doesn't crash the scan", async () => {
  const { ctx } = await loadApp({ seed: 403 });
  const exported = preChangeState({ considered: { z: "worked" } });   // pre-change export: a worked mark, no workedAt, no workedHours
  ctx.document.getElementById("jsonBox").value = JSON.stringify(exported);
  ctx.onAction("import-json", {});
  assert.equal(ctx.state.settings.workedHours, 16, "the window setting is filled in on import");
  assert.ok(ctx.state.workedAt && typeof ctx.state.workedAt === "object", "the timestamp map exists on import");
  assert.doesNotThrow(() => ctx.ensureCandidate(), "the scan's expiry sweep must not trip over the imported shape");
  assert.ok(typeof ctx.state.workedAt.z === "number", "the imported worked mark is given a start point, not left stuck");
});

test("data from before this change: a stored 'worked' task with no timestamp is honoured, given a window from boot, then rejoins the scan", async () => {
  const stored = preChangeState({
    tasks: [
      { id: "a", title: "Kept scanning", url: null, due: null, evergreen: false, ctx: [], mu: 25, sigma: 8.333, done: false, createdAt: 1, completedAt: null, lastDoneAt: null, startsAt: null },
      { id: "w", title: "Was worked before the update", url: null, due: null, evergreen: false, ctx: [], mu: 25, sigma: 8.333, done: false, createdAt: 1, completedAt: null, lastDoneAt: null, startsAt: null },
    ],
    chain: ["a"],
    considered: { w: "worked" },                          // the pre-change mark — no timestamp anywhere
  });
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });

  assert.equal(ctx.state.settings.workedHours, 16, "migration ran");
  assert.equal(ctx.state.considered.w, "worked", "the old mark is honoured, not dropped on load");
  assert.ok(typeof ctx.state.workedAt.w === "number", "and it gets a start timestamp backfilled at boot");
  assert.ok(!ctx.pool().some((t) => t.id === "w"), "so it stays out of the scan for a bounded window");

  const bootStamp = ctx.state.workedAt.w;
  setFakeTime(ctx, ctx.workedUntil(bootStamp) + 1000);    // past the window measured from boot
  ctx.ensureCandidate();
  assert.ok(ctx.pool().some((t) => t.id === "w"), "rejoins the scan once that window elapses");
  assert.equal(ctx.state.considered.w, undefined);
});

/* ---- save-settings validation (mirrors the cantMin tests) ---- */

test("save-settings: workedHours is read, clamped [1,720], and persisted independently of the other fields", async () => {
  const { ctx } = await loadApp({ seed: 404 });
  setInput(ctx, "stHorizon", 90);
  setInput(ctx, "stCantMin", 30);
  setInput(ctx, "stThresh", 25);
  setInput(ctx, "stSamples", 250);
  setInput(ctx, "stWorkedHrs", 12);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.workedHours, 12);
  assert.equal(ctx.state.settings.cantMin, 30, "an unrelated field must be untouched");
});

test("save-settings: workedHours below 1 clamps up to 1, above 720 clamps down to 720", async () => {
  const { ctx } = await loadApp({ seed: 405 });
  setInput(ctx, "stHorizon", 60); setInput(ctx, "stCantMin", 30);
  setInput(ctx, "stThresh", 25); setInput(ctx, "stSamples", 250);

  setInput(ctx, "stWorkedHrs", -3);                       // non-zero, so it clamps rather than hitting the fallback
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.workedHours, 1);

  setInput(ctx, "stWorkedHrs", 9999);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.workedHours, 720);
});

test("save-settings: a blank or non-numeric workedHours falls back to 8", async () => {
  const { ctx } = await loadApp({ seed: 406 });
  setInput(ctx, "stHorizon", 60); setInput(ctx, "stCantMin", 30);
  setInput(ctx, "stThresh", 25); setInput(ctx, "stSamples", 250);
  setInput(ctx, "stWorkedHrs", "");
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.workedHours, 8);
});

test("save-settings: a literal 0 workedHours is falsy and falls back to 8, not clamped to 1", async () => {
  const { ctx } = await loadApp({ seed: 407 });
  setInput(ctx, "stHorizon", 60); setInput(ctx, "stCantMin", 30);
  setInput(ctx, "stThresh", 25); setInput(ctx, "stSamples", 250);
  setInput(ctx, "stWorkedHrs", 0);
  ctx.onAction("save-settings", {});
  assert.equal(ctx.state.settings.workedHours, 8, "0 hits the ||8 fallback the same way horizonMin/cantMin do");
});

/* ---- settings UI ---- */

test("openSettings: renders a workedHours input prefilled with the current value", async () => {
  const { ctx, shim } = await loadApp({ seed: 408 });
  ctx.state.settings.workedHours = 8;
  ctx.openSettings();
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, /id="stWorkedHrs"/, `expected a workedHours field in: ${html}`);
  assert.match(html, /id="stWorkedHrs"[^>]*value="8"/, "should be prefilled with the current setting");
});

/* ---- workedOnTask stamps the timestamp ---- */

test("workedOnTask: stamps state.workedAt with the time the mark was set", async () => {
  const { ctx } = await loadApp({ seed: 409 });
  const t = ctx.addTask("Task A", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.workedOnTask(t.id);
  assert.equal(ctx.state.considered[t.id], "worked", "still marks it worked");
  assert.equal(ctx.state.workedAt[t.id], t0, "and records when, so it can expire on its own");
});

test("workedOnTask: still logs its History entry alongside the new timestamp", async () => {
  const { ctx } = await loadApp({ seed: 410 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  const entry = ctx.state.workLog.find((e) => e.taskId === t.id);
  assert.ok(entry && entry.kind === "worked", "the work-log entry must survive the change");
});

test("workedOn: the benchmark-card path also stamps workedAt", async () => {
  const { ctx } = await loadApp({ seed: 411 });
  const t = ctx.addTask("Dotted task", true);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.workedOn();
  assert.equal(ctx.state.considered[t.id], "worked");
  assert.equal(ctx.state.workedAt[t.id], t0);
});

/* ---- bulletproof against newPass while fresh ---- */

test("a fresh worked mark survives the chain emptying out (newPass), regardless of ~0 elapsed time", async () => {
  const { ctx } = await loadApp({ seed: 412 });
  ctx.addTask("Only queued task", true);                  // dotted — this is what empties the chain
  const w = ctx.addTask("Worked on this one", false);
  ctx.workedOnTask(w.id);

  ctx.benchDone();                                        // chain -> empty -> newPass()

  assert.equal(ctx.state.chain.length, 0);
  assert.equal(ctx.state.considered[w.id], "worked", "the worked mark must survive newPass() while still fresh");
});

/* ---- expires on its own schedule ----
   A worked mark releases at min(workedAt + workedHours, the next 02:00 local).
   The 02:00 day line is a hard ceiling: worked on yesterday is today's concern,
   so no window — however long the user sets it — carries a mark past the next
   02:00. A short window can still end the hold earlier, within the same day.
   These anchor to fixed local times so which limit bites is deterministic,
   rather than depending on the hour the suite runs. */
const localAt = (day, h, m) => new Date(2026, 7, day, h, m || 0).getTime();

test("a worked mark expires mid-session once its window is up (no newPass needed)", async () => {
  const { ctx } = await loadApp({ seed: 413 });
  ctx.state.settings.workedHours = 25;                    // longer than a day — so the 02:00 line, not the window, is what ends it
  ctx.addTask("Task A", false);
  const w = ctx.addTask("Worked", false);
  ctx.startScan();                                        // dots Task A, so "Worked" is the one on offer

  const t0 = localAt(30, 3, 0);                           // 3am Sunday
  setFakeTime(ctx, t0);
  ctx.workedOnTask(w.id);
  assert.ok(!ctx.pool().some((t) => t.id === w.id), "excluded from the pool right after being marked");

  setFakeTime(ctx, localAt(30, 23, 0));                   // Sun 23:00 — 20h in, the next 02:00 not yet reached
  ctx.ensureCandidate();
  assert.ok(!ctx.pool().some((t) => t.id === w.id), "before the day line the mark still holds");

  setFakeTime(ctx, localAt(31, 2, 0));                    // Mon 02:00 — the day line, 2h before the 25h window would end
  ctx.ensureCandidate();
  assert.ok(ctx.pool().some((t) => t.id === w.id), "the 02:00 ceiling releases it — the long window never gets to bite");
  assert.equal(ctx.state.considered[w.id], undefined);
});

test("REGRESSION: a task worked on in the morning is not dealt back the same day", async () => {
  // The report: marked worked at 7:38am, offered again as a candidate at 5:29pm
  // the same afternoon, crossed off a second time, logged twice for one day.
  // On the 16h default the min() release lands at 23:38 — the working day is
  // still covered. See the sibling test for what a sub-day window gives up.
  const { ctx } = await loadApp({ seed: 4131 });
  assert.equal(ctx.state.settings.workedHours, 16, "sanity: the default window this regression leans on");
  ctx.addTask("Task A", false);
  const w = ctx.addTask("beat mafia 1 definitive edition", false);
  ctx.startScan();

  setFakeTime(ctx, localAt(31, 7, 38));
  ctx.workedOnTask(w.id);

  setFakeTime(ctx, localAt(31, 17, 29));                  // 9h51m later — the exact hour from the report
  ctx.ensureCandidate();

  assert.equal(ctx.state.considered[w.id], "worked", "the mark holds through the working day");
  assert.ok(!ctx.pool().some((t) => t.id === w.id), "so it is never dealt back as a candidate that afternoon");
});

test("a sub-day worked window can hand a morning task back the same evening — the min() trade-off", async () => {
  // Flipping the 02:00 line from a floor to a ceiling means workedHours is no
  // longer padded up to it. An 8h window set in the morning genuinely releases
  // in the evening now. Accepted deliberately: "worked yesterday is today's
  // concern" is worth more than shielding a window the user shortened below a
  // waking day, and reconcileWorkLog() still collapses a same-day repeat in
  // History if a second session does happen.
  const { ctx } = await loadApp({ seed: 41310 });
  ctx.state.settings.workedHours = 8;
  ctx.addTask("Task A", false);
  const w = ctx.addTask("beat mafia 1 definitive edition", false);
  ctx.startScan();

  setFakeTime(ctx, localAt(31, 7, 38));
  ctx.workedOnTask(w.id);

  setFakeTime(ctx, localAt(31, 16, 0));                   // 8h22m later — past the 8h window, same day
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], undefined, "the short window releases it the same evening");
  assert.ok(ctx.pool().some((t) => t.id === w.id));
});

test("on the default window it comes back the next day, when the pass day rolls over", async () => {
  const { ctx } = await loadApp({ seed: 4132 });
  assert.equal(ctx.state.settings.workedHours, 16);
  ctx.addTask("Task A", false);
  const w = ctx.addTask("beat mafia 1 definitive edition", false);
  ctx.startScan();

  setFakeTime(ctx, localAt(31, 20, 0));                   // Mon 20:00 — 16h out is noon Tue, past the day line
  ctx.workedOnTask(w.id);

  setFakeTime(ctx, localAt(32, 1, 0));                    // Tue 01:00 — before the 02:00 line
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], "worked", "still last night's mark until the day rolls over");

  setFakeTime(ctx, localAt(32, 2, 30));                   // Tue 02:30 — past the line, hours before the 16h window
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], undefined, "the 02:00 line puts it back, not the window");
  assert.ok(ctx.pool().some((t) => t.id === w.id));
});

test("a late-night worked mark is released at 02:00, not workedHours later", async () => {
  // Worked on at bedtime, back in play when the day turns. Rule 7 sends a task
  // to the bottom of the list; the bottom is a new day's list, not a slot 16
  // hours from now. The window only ever shortens the hold below the day line —
  // it can never push a mark past it.
  const { ctx } = await loadApp({ seed: 4133 });
  ctx.state.settings.workedHours = 16;
  ctx.addTask("Task A", false);
  const w = ctx.addTask("Worked at bedtime", false);
  ctx.startScan();

  setFakeTime(ctx, localAt(30, 23, 0));                   // 11pm Sunday; 02:00 Monday is only 3h away
  ctx.workedOnTask(w.id);

  setFakeTime(ctx, localAt(31, 1, 30));                   // Mon 01:30 — still the same day
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], "worked", "before 02:00 the mark holds");

  setFakeTime(ctx, localAt(31, 2, 30));                   // Mon 02:30 — past the day line, 13h of the window unspent
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], undefined, "the day line releases it");
  assert.ok(ctx.pool().some((t) => t.id === w.id), "and it can be dealt again today");
});

/* ---- workedUntil: the two limits, and which one bites ---- */

test("workedUntil returns the earlier of workedHours and the next 02:00", async () => {
  const { ctx } = await loadApp({ seed: 41331 });
  ctx.state.settings.workedHours = 16;

  // Worked late Sunday: 02:00 Monday is 3h away, far inside the 16h window, so
  // the day line is the earlier limit and the one that counts.
  const lateSun = localAt(30, 23, 0);
  assert.equal(ctx.workedUntil(lateSun), localAt(31, 2, 0), "late-evening mark: released at the next 02:00");
  assert.ok(ctx.workedUntil(lateSun) < lateSun + 16 * 3600000, "which is well short of the full window");

  // Worked exactly at 02:00: passResetCutoff jumps to the NEXT day's 02:00
  // (never instant), so now the 16h window is the earlier limit.
  const atReset = localAt(31, 2, 0);
  assert.equal(ctx.workedUntil(atReset), atReset + 16 * 3600000, "a mark set at 02:00 sharp runs the full window, not zero");
});

test("workedUntil: a window shorter than the time to 02:00 is the limit that bites", async () => {
  const { ctx } = await loadApp({ seed: 41332 });
  ctx.state.settings.workedHours = 2;

  const midAfternoon = localAt(30, 14, 0);                // 02:00 is 12h away; the 2h window ends first
  assert.equal(ctx.workedUntil(midAfternoon), midAfternoon + 2 * 3600000, "short window ends the hold, same day");
  assert.ok(ctx.workedUntil(midAfternoon) < ctx.passResetCutoff(midAfternoon));
});

test("boundary: a mark set in the 01:00 hour lives only until 02:00, about an hour", async () => {
  const { ctx } = await loadApp({ seed: 41333 });
  ctx.state.settings.workedHours = 16;

  const oneAm = localAt(31, 1, 0);
  assert.equal(ctx.workedUntil(oneAm), localAt(31, 2, 0), "the very next 02:00, not +16h");
});

test("crossing 02:00 recycles a worked mark with the pass — not just no / dislodged marks", async () => {
  const { ctx } = await loadApp({ seed: 4134 });
  ctx.state.settings.workedHours = 16;                    // long window; only the day line can end it early
  ctx.addTask("Benchmark", false);
  const w = ctx.addTask("Worked last night", false);
  setFakeTime(ctx, localAt(30, 22, 0));                   // Sun 22:00 — the pass starts
  ctx.startScan();
  setFakeTime(ctx, localAt(30, 23, 0));                   // Sun 23:00 — worked on it
  ctx.workedOnTask(w.id);

  setFakeTime(ctx, localAt(31, 1, 59));                   // Mon 01:59 — day line not crossed
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], "worked", "same day still: the mark holds");

  setFakeTime(ctx, localAt(31, 2, 30));                   // Mon 02:30 — crossed the day line -> auto newPass()
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], undefined, "new day, new concern: the worked mark recycles with the pass");
  assert.equal(ctx.state.workedAt[w.id], undefined, "and its timestamp is swept");
  assert.ok(ctx.pool().some((t) => t.id === w.id), "so the task is dealable again today");
});

test("a worked mark that has genuinely outlived workedHours IS cleared by newPass()", async () => {
  const { ctx } = await loadApp({ seed: 414 });
  ctx.state.settings.workedHours = 2;
  ctx.addTask("Only queued task", true);
  const w = ctx.addTask("Old worked", false);

  const t0 = localAt(30, 3, 0);
  setFakeTime(ctx, t0);
  ctx.workedOnTask(w.id);

  setFakeTime(ctx, localAt(31, 6, 0));                    // next morning — past the 2h window and the day line
  ctx.benchDone();                                        // -> newPass()

  assert.equal(ctx.state.considered[w.id], undefined, "an expired worked mark should be dropped, not preserved forever");
  assert.equal(ctx.state.workedAt[w.id], undefined, "its timestamp should be cleaned up too");
});

test("shrinking workedHours below the elapsed time expires an existing worked mark on the next check", async () => {
  const { ctx } = await loadApp({ seed: 415 });
  ctx.state.settings.workedHours = 10;
  ctx.addTask("Task A", false);
  const w = ctx.addTask("Worked", false);
  ctx.startScan();

  const t0 = localAt(30, 3, 0);
  setFakeTime(ctx, t0);
  ctx.workedOnTask(w.id);

  setFakeTime(ctx, localAt(31, 6, 0));                    // next morning, still inside a 10h... no: past it
  ctx.state.settings.workedHours = 2;                     // now far shorter than the time already elapsed
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[w.id], undefined, "shrinking the window below elapsed time expires it on the next check");
});

/* ---- AUDIT: orphans and data from before this change ---- */

test("AUDIT: a pre-existing worked mark with no workedAt timestamp gets one backfilled, not silently cleared", async () => {
  const { ctx } = await loadApp({ seed: 416 });
  ctx.addTask("Task A", false);
  const orphan = ctx.addTask("Orphaned worked", false);
  ctx.state.considered[orphan.id] = "worked";             // old data: mark present, no timestamp
  assert.equal(ctx.state.workedAt[orphan.id], undefined, "sanity: no timestamp yet");

  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[orphan.id], "worked", "must NOT be silently un-worked by the audit");
  assert.ok(typeof ctx.state.workedAt[orphan.id] === "number", "a fresh timestamp should have been backfilled");
});

test("AUDIT: a backfilled worked mark then expires normally on its fresh schedule", async () => {
  const { ctx } = await loadApp({ seed: 417 });
  ctx.state.settings.workedHours = 4;
  ctx.addTask("Task A", false);
  const orphan = ctx.addTask("Orphaned worked", false);
  ctx.state.considered[orphan.id] = "worked";

  const t0 = localAt(30, 3, 0);
  setFakeTime(ctx, t0);
  ctx.ensureCandidate();                                  // backfills workedAt[orphan] = t0
  assert.equal(ctx.state.workedAt[orphan.id], t0);

  setFakeTime(ctx, t0 + 2 * 3600000);
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[orphan.id], "worked", "still bulletproof within its freshly-backfilled window");

  setFakeTime(ctx, localAt(31, 6, 0));                    // next morning, past window and day line alike
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[orphan.id], undefined, "expires once the backfilled window elapses");
});

test("AUDIT (reverse): a workedAt timestamp with no matching worked mark is swept", async () => {
  const { ctx } = await loadApp({ seed: 418 });
  const t = ctx.addTask("Task A", false);
  ctx.state.workedAt[t.id] = realNow(ctx);                // leftover timestamp, no considered["worked"]
  ctx.ensureCandidate();
  assert.equal(ctx.state.workedAt[t.id], undefined, "an orphaned timestamp should not linger");
});

test("AUDIT (reverse): a workedAt left behind after the mark changed to something else is swept", async () => {
  const { ctx } = await loadApp({ seed: 419 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "no";                      // some other path changed the status
  ctx.state.workedAt[t.id] = realNow(ctx);                // but the worked timestamp was left behind
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[t.id], "no", "the non-worked status is untouched");
  assert.equal(ctx.state.workedAt[t.id], undefined, "its stale workedAt is cleaned up");
});

test("AUDIT: does not disturb a worked mark that already has a valid timestamp", async () => {
  const { ctx } = await loadApp({ seed: 420 });
  const t = ctx.addTask("Task A", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.workedOnTask(t.id);                                 // sets considered + workedAt together
  ctx.ensureCandidate();                                  // audit runs again
  assert.equal(ctx.state.workedAt[t.id], t0, "an already-correct timestamp must not be overwritten");
});

/* ---- cleanup: no lingering timestamps ---- */

test("deleteTask cleans up workedAt too, so no orphaned timestamps linger", async () => {
  const { ctx } = await loadApp({ seed: 421 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  assert.ok(ctx.state.workedAt[t.id]);
  ctx.deleteTask(t.id);
  assert.equal(ctx.state.workedAt[t.id], undefined);
});

test("doneTask cleans up workedAt", async () => {
  const { ctx } = await loadApp({ seed: 422 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  ctx.doneTask(t.id);
  assert.equal(ctx.state.workedAt[t.id], undefined);
});

test("returnAsCandidate clears the worked mark and its workedAt timestamp", async () => {
  const { ctx } = await loadApp({ seed: 423 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  ctx.returnAsCandidate(t.id);
  assert.equal(ctx.state.considered[t.id], undefined);
  assert.equal(ctx.state.workedAt[t.id], undefined);
});

test("decide('yes') clears any workedAt on the dotted task, mirroring its cantAt cleanup", async () => {
  const { ctx } = await loadApp({ seed: 424 });
  ctx.addTask("Benchmark", true);
  ctx.addTask("Candidate", false);
  ctx.startScan();
  const cand = ctx.state.candidateId;
  assert.ok(cand, "precondition: a candidate is on offer");
  ctx.state.workedAt[cand] = realNow(ctx);               // plant a stale timestamp on the candidate
  ctx.decide("yes");
  assert.equal(ctx.state.workedAt[cand], undefined, "a dotted task must not carry a worked timestamp");
});

test("rescanSkipped clears the worked mark and its workedAt", async () => {
  const { ctx } = await loadApp({ seed: 425 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  assert.ok(ctx.state.workedAt[t.id]);
  ctx.rescanSkipped();
  assert.equal(ctx.state.considered[t.id], undefined, "rescan clears worked marks like it always has");
  assert.equal(ctx.state.workedAt[t.id], undefined, "and no longer leaves the timestamp behind");
});

/* ---- list badge ---- */

test("skippedLabel: a fresh worked mark shows a remaining-hours countdown; a stale or untimestamped one shows plain 'worked'", async () => {
  const { ctx } = await loadApp({ seed: 426 });
  ctx.state.settings.workedHours = 8;
  const t = ctx.addTask("Task A", false);
  const t0 = localAt(30, 3, 0);                           // Sun 03:00 — the 8h window (Sun 11:00) is nearer than the next 02:00
  setFakeTime(ctx, t0);
  ctx.workedOnTask(t.id);

  assert.match(ctx.skippedLabel(t.id, "worked"), /worked · \d+h/, "fresh: shows hours left");

  setFakeTime(ctx, t0 + 9 * 3600000);                     // Sun 12:00 — past the 8h window
  assert.equal(ctx.skippedLabel(t.id, "worked"), "worked", "elapsed: falls back to the bare label");

  delete ctx.state.workedAt[t.id];
  assert.equal(ctx.skippedLabel(t.id, "worked"), "worked", "no timestamp: bare label, no NaN");
});

test("skippedLabel: the countdown tracks the nearer 02:00 ceiling, not the full window", async () => {
  const { ctx } = await loadApp({ seed: 4261 });
  ctx.state.settings.workedHours = 16;
  const t = ctx.addTask("Task A", false);
  setFakeTime(ctx, localAt(30, 23, 0));                   // Sun 23:00 — 02:00 Monday is 3h away, far short of 16h
  ctx.workedOnTask(t.id);

  assert.equal(ctx.skippedLabel(t.id, "worked"), "worked · 3h", "shows the hours to the day line, not 16");
});

/* =====================================================================
   A SCAN PASS GOES STALE AFTER 18 HOURS
   FVP builds one chain per pass. The skip marks from that pass (no,
   dislodged, and an evergreen completion's "done") only clear when the
   chain drains and newPass() runs. On a scan that spans more than a day
   without the chain ever emptying, those marks — and an evergreen you
   finished hours ago — never recycle. So the pass carries a start time
   (state.passStartedAt); once it is STALE_PASS_MS old, the next
   ensureCandidate() auto-runs newPass(). The chain is left intact, and
   fresh can't / worked marks keep their own windows.
   ===================================================================== */

test("STALE_PASS_MS is 18 hours", async () => {
  const { ctx } = await loadApp({ seed: 441 });
  assert.equal(readConst(ctx, "STALE_PASS_MS"), 18 * 3600000);
});

test("defaultState includes passStartedAt: 0", async () => {
  const { ctx } = await loadApp({ seed: 440 });
  assert.equal(ctx.state.passStartedAt, 0);
});

test("passStartedAt: starting a chain stamps the pass start time", async () => {
  const { ctx } = await loadApp({ seed: 430 });
  assert.equal(ctx.state.passStartedAt, 0, "no pass has started yet on a fresh state");

  ctx.addTask("A", false);
  ctx.addTask("B", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.startScan();                                  // dots the oldest — this begins a pass
  assert.equal(ctx.state.passStartedAt, t0, "starting a chain stamps the pass start time");
});

test("passStartedAt: resuming a paused scan does NOT re-stamp the pass", async () => {
  const { ctx } = await loadApp({ seed: 431 });
  ctx.addTask("A", false);
  ctx.addTask("B", false);
  ctx.addTask("C", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.startScan();                                  // begins the pass, stamps t0
  assert.equal(ctx.state.passStartedAt, t0);

  ctx.decide("yes");                                // push the candidate onto the chain
  setFakeTime(ctx, t0 + 60000);
  ctx.benchDone();                                  // completes the head; chain still non-empty, mode -> "work"
  assert.ok(ctx.state.chain.length >= 1, "precondition: chain not drained");

  setFakeTime(ctx, t0 + 120000);
  ctx.startScan();                                  // resume
  assert.equal(ctx.state.passStartedAt, t0, "resuming must not restart the 18h clock");
});

test("passStartedAt: newPass() stamps the pass start time", async () => {
  const { ctx } = await loadApp({ seed: 432 });
  ctx.addTask("A", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0 + 5000);
  ctx.newPass();
  assert.equal(ctx.state.passStartedAt, t0 + 5000);
});

test("a pass 18h old auto-runs newPass() on the next ensureCandidate(): no / dislodged marks clear", async () => {
  const { ctx } = await loadApp({ seed: 433 });
  ctx.addTask("Benchmark", false);
  ctx.addTask("Said no", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.startScan();                                  // dots "Benchmark" (oldest); pass starts at t0
  const noId = ctx.state.candidateId;
  ctx.decide("no");
  assert.equal(ctx.state.considered[noId], "no");

  ctx.addTask("Dot me", true);                      // chain = [Benchmark, Dot me]
  const dislodgedId = ctx.state.tasks.find((t) => t.title === "Dot me").id;
  ctx.dislodge();                                   // pops "Dot me", marks it "dislodged"
  assert.equal(ctx.state.considered[dislodgedId], "dislodged");

  setFakeTime(ctx, t0 + 18 * 3600000);              // 18h later
  ctx.ensureCandidate();

  assert.equal(ctx.state.considered[noId], undefined, "an 18h-old 'no' recycles");
  assert.equal(ctx.state.considered[dislodgedId], undefined, "an 18h-old 'dislodged' recycles");
});

test("a pass 17h old that has not crossed 02:00 does NOT recycle — the marks are still there", async () => {
  const { ctx } = await loadApp({ seed: 434 });
  ctx.addTask("Benchmark", false);
  ctx.addTask("Said no", false);
  setFakeTime(ctx, new Date(2026, 7, 28, 6, 0, 0).getTime());   // Fri 06:00 — next 02:00 is 20h away
  ctx.startScan();
  const noId = ctx.state.candidateId;
  ctx.decide("no");

  setFakeTime(ctx, new Date(2026, 7, 28, 23, 0, 0).getTime());  // Fri 23:00 — 17h in, still Friday's "day"
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[noId], "no", "17h in, no 02:00 crossed — pass is not yet stale");
});

test("the 18h auto-recycle leaves the chain and its benchmark untouched", async () => {
  const { ctx } = await loadApp({ seed: 435 });
  ctx.addTask("First", true);
  ctx.addTask("Second", true);
  ctx.addTask("Third", true);                       // chain = [First, Second, Third]
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.newPass();                                    // stamps passStartedAt = t0; newPass never touches the chain
  const chainBefore = [...ctx.state.chain];
  const benchBefore = ctx.benchmark().id;

  setFakeTime(ctx, t0 + 19 * 3600000);
  ctx.ensureCandidate();

  assert.deepEqual([...ctx.state.chain], chainBefore, "every dotted task stays dotted");
  assert.equal(ctx.benchmark().id, benchBefore, "the benchmark is the same task");
});

test("fresh can't and worked marks survive the 18h auto-recycle — their own windows still apply", async () => {
  const { ctx } = await loadApp({ seed: 436 });
  ctx.state.settings.cantMin = 60;                  // 1h window
  ctx.state.settings.workedHours = 8;               // 8h window
  ctx.addTask("Benchmark", false);
  const cantT = ctx.addTask("Can't do it", false);
  const workedT = ctx.addTask("Worked on it", false);
  // Fixed local 03:00 so the whole span stays inside one 02:00-to-02:00 day:
  // the 18h ceiling is the trigger under test, and — now that the day line is a
  // hard ceiling on a worked mark too — no 02:00 crossing sneaks in to expire
  // the 30-min-old mark early. (With realNow() this flaked when the suite ran
  // near 08:00 and `late` landed on top of an 02:00.)
  const t0 = localAt(30, 3, 0);
  setFakeTime(ctx, t0);
  ctx.startScan();                                  // pass starts at t0
  assert.equal(ctx.state.passStartedAt, t0);

  // Both marks placed 30 min before the recycle — fresh within their own windows.
  const late = t0 + 17.5 * 3600000;                 // Sun 20:30
  ctx.state.considered[cantT.id] = "cant";     ctx.state.cantAt[cantT.id] = late;
  ctx.state.considered[workedT.id] = "worked"; ctx.state.workedAt[workedT.id] = late;

  setFakeTime(ctx, t0 + 18 * 3600000);              // Sun 21:00 — pass is 18h old; the marks are 30 min old; no 02:00 crossed
  ctx.ensureCandidate();                            // -> auto newPass()

  assert.equal(ctx.state.considered[cantT.id], "cant", "a 30-min-old can't is still within its 1h window");
  assert.equal(ctx.state.considered[workedT.id], "worked", "a 30-min-old worked mark is still within its window and before the next 02:00");
});

test("after an auto-recycle, passStartedAt is re-stamped so it does not recycle again immediately", async () => {
  const { ctx } = await loadApp({ seed: 437 });
  ctx.addTask("Benchmark", false);
  ctx.addTask("Said no", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.startScan();
  const noId = ctx.state.candidateId;
  ctx.decide("no");

  const recycleAt = t0 + 18 * 3600000;
  setFakeTime(ctx, recycleAt);
  ctx.ensureCandidate();                            // recycles
  assert.equal(ctx.state.passStartedAt, recycleAt, "the clock restarts from the recycle moment");

  ctx.state.considered[noId] = "no";                // plant a fresh mark
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[noId], "no", "not stale again — no second recycle back-to-back");
});

test("an evergreen task finished mid-pass is back in the pool after the 18h recycle", async () => {
  const { ctx } = await loadApp({ seed: 438 });
  ctx.addTask("Anchor task", false);               // oldest -> becomes the chain root
  const ever = ctx.addTask("Put on clothes", false);
  ctx.state.tasks.find((t) => t.id === ever.id).evergreen = true;
  ctx.addTask("Filler", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.startScan();                                  // dots "Anchor task"; pass starts at t0

  setFakeTime(ctx, t0 + 3600000);                   // an hour in
  ctx.state.candidateId = ever.id;                  // the evergreen comes up as the candidate
  ctx.decide("cand-done");                          // "did it now" -> completeTask: evergreen -> considered "done"
  assert.equal(ctx.state.considered[ever.id], "done");
  assert.ok(!ctx.pool().some((t) => t.id === ever.id), "out of the pool while the done mark stands");

  setFakeTime(ctx, t0 + 18 * 3600000);              // pass goes stale (also well past the 90-min evergreen rest)
  ctx.ensureCandidate();

  assert.equal(ctx.state.considered[ever.id], undefined, "the done mark is recycled");
  assert.ok(ctx.pool().some((t) => t.id === ever.id), "the evergreen is a candidate again");
});

test("migration: a state with no passStartedAt loads as 0 and never auto-recycles until a real pass starts", async () => {
  const stored = preChangeState();
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });
  assert.equal(ctx.state.passStartedAt, 0, "absent in old data -> 0");

  ctx.addTask("A", false);
  ctx.addTask("B", false);
  ctx.startScan();
  const noId = ctx.state.candidateId;
  ctx.decide("no");
  ctx.state.passStartedAt = 0;                      // simulate a state with no pass in progress and no start time
  setFakeTime(ctx, realNow(ctx) + 48 * 3600000);    // two days later
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[noId], "no", "passStartedAt 0 never triggers a recycle, no matter the elapsed time");
});

test("existing data: a pre-change state loaded mid-pass (chain present, no passStartedAt) gets a fresh 18h window from load", async () => {
  const stored = preChangeState({
    chain: ["root"],
    tasks: [
      { id: "root", title: "Chain root", url: null, due: null, evergreen: false, ctx: [], mu: 25, sigma: 8.333, done: false, createdAt: 1, completedAt: null, lastDoneAt: null, startsAt: null },
      { id: "other", title: "Other", url: null, due: null, evergreen: false, ctx: [], mu: 25, sigma: 8.333, done: false, createdAt: 2, completedAt: null, lastDoneAt: null, startsAt: null },
    ],
    considered: { other: "no" },                    // a lingering skip mark from the pre-change pass
  });
  const loadAt = Date.now();
  const { ctx } = await loadApp({ seedStorage: { [WH_STORE_KEY]: JSON.stringify(stored) } });

  assert.ok(ctx.state.passStartedAt >= loadAt, "an in-progress pass with no start time is stamped as of load, not left at 0");
  assert.ok(ctx.state.passStartedAt <= Date.now(), "and not stamped in the future");

  ctx.ensureCandidate();
  assert.equal(ctx.state.considered.other, "no", "not treated as instantly stale on the first check after upgrade");

  setFakeTime(ctx, ctx.state.passStartedAt + 18 * 3600000);
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered.other, undefined, "the stale pre-change pass recycles one full window after the upgrade");
});

test("the stale-pass recycle keeps firing day after day, not just once", async () => {
  const { ctx } = await loadApp({ seed: 442 });
  ctx.addTask("Benchmark", false);
  const skip = ctx.addTask("Skip me", false);
  const start = new Date(2026, 7, 27, 20, 0, 0).getTime();       // Thu 20:00
  setFakeTime(ctx, start);
  ctx.startScan();

  for (let day = 1; day <= 5; day++) {
    ctx.state.considered[skip.id] = "no";                        // a fresh mark, left overnight
    setFakeTime(ctx, start + day * 86400000);                    // 24h later each pass — always stale by one trigger or the other
    ctx.ensureCandidate();
    assert.equal(ctx.state.considered[skip.id], undefined, `day ${day}: a mark left overnight is recycled`);
  }
});

test("the stale-pass recycle catches up a multi-day gap in one shot, then rearms for the next window", async () => {
  const { ctx } = await loadApp({ seed: 443 });
  ctx.addTask("Benchmark", false);
  const skip = ctx.addTask("Skip me", false);
  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.startScan();

  ctx.state.considered[skip.id] = "no";
  setFakeTime(ctx, t0 + 50 * 3600000);             // away for ~2 days
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], undefined, "one recycle covers the whole gap");
  assert.equal(ctx.state.passStartedAt, t0 + 50 * 3600000, "clock rearmed from the moment it noticed");

  ctx.state.considered[skip.id] = "no";
  setFakeTime(ctx, t0 + 50 * 3600000 + 18 * 3600000);
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], undefined, "and it fires again one window later");
});

/* ---------- secondary trigger: crossing 02:00 local time ----------
   18h is only the ceiling. The pass is also stale the moment the local clock
   crosses 02:00 after it started — the "new day" line, which on any evening
   start is what actually trips first. */

test("passResetCutoff: the first 02:00 local strictly after the given moment", async () => {
  const { ctx } = await loadApp({ seed: 444 });
  const cut = (y, mo, da, h, mi) => ctx.passResetCutoff(new Date(y, mo, da, h, mi, 0).getTime());
  assert.equal(cut(2026, 7, 27, 22, 0), new Date(2026, 7, 28, 2, 0, 0).getTime(), "22:00 -> 02:00 next day");
  assert.equal(cut(2026, 7, 28, 9, 0),  new Date(2026, 7, 29, 2, 0, 0).getTime(), "09:00 -> 02:00 next day");
  assert.equal(cut(2026, 7, 28, 1, 0),  new Date(2026, 7, 28, 2, 0, 0).getTime(), "01:00 -> 02:00 the same day");
  assert.equal(cut(2026, 7, 28, 2, 0),  new Date(2026, 7, 29, 2, 0, 0).getTime(), "exactly 02:00 -> 02:00 the NEXT day, never instant");
});

test("a pass started before 02:00 recycles the moment the clock crosses it, well under 18h", async () => {
  const { ctx } = await loadApp({ seed: 445 });
  ctx.addTask("Benchmark", false);
  const skip = ctx.addTask("Skip me", false);
  setFakeTime(ctx, new Date(2026, 7, 27, 22, 0, 0).getTime());   // Thu 22:00
  ctx.startScan();
  ctx.state.considered[skip.id] = "no";

  setFakeTime(ctx, new Date(2026, 7, 28, 1, 59, 0).getTime());   // 01:59 — not yet
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], "no", "01:59: the pass has not crossed 02:00");

  setFakeTime(ctx, new Date(2026, 7, 28, 2, 0, 0).getTime());    // 02:00 sharp
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], undefined, "02:00: crossed the day line — recycle after only 4h");
});

test("a pass that stays within one 02:00-to-02:00 day and under 18h does not recycle", async () => {
  const { ctx } = await loadApp({ seed: 446 });
  ctx.addTask("Benchmark", false);
  const skip = ctx.addTask("Skip me", false);
  setFakeTime(ctx, new Date(2026, 7, 28, 10, 0, 0).getTime());   // Fri 10:00
  ctx.startScan();
  ctx.state.considered[skip.id] = "no";

  setFakeTime(ctx, new Date(2026, 7, 28, 23, 30, 0).getTime());  // Fri 23:30 — 13.5h, no 02:00 crossed
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], "no", "within the same day and under 18h — pass stands");
});

test("a pass started exactly at 02:00 is not instantly stale", async () => {
  const { ctx } = await loadApp({ seed: 447 });
  ctx.addTask("Benchmark", false);
  const skip = ctx.addTask("Skip me", false);
  setFakeTime(ctx, new Date(2026, 7, 28, 2, 0, 0).getTime());    // 02:00:00 sharp
  ctx.startScan();
  ctx.state.considered[skip.id] = "no";

  setFakeTime(ctx, new Date(2026, 7, 28, 2, 5, 0).getTime());    // five minutes later
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], "no", "the cutoff is the NEXT 02:00, not the one it started on");
});

test("the 02:00 trigger rearms for the following day after it fires", async () => {
  const { ctx } = await loadApp({ seed: 448 });
  ctx.addTask("Benchmark", false);
  const skip = ctx.addTask("Skip me", false);
  setFakeTime(ctx, new Date(2026, 7, 27, 23, 0, 0).getTime());   // Thu 23:00
  ctx.startScan();

  ctx.state.considered[skip.id] = "no";
  setFakeTime(ctx, new Date(2026, 7, 28, 2, 0, 0).getTime());    // Fri 02:00 -> recycle #1
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], undefined, "recycled at the first 02:00");

  ctx.state.considered[skip.id] = "no";
  setFakeTime(ctx, new Date(2026, 7, 28, 12, 0, 0).getTime());   // Fri midday — no new 02:00 since the re-stamp, under 18h
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], "no", "not stale again the same day");

  ctx.state.considered[skip.id] = "no";
  setFakeTime(ctx, new Date(2026, 7, 29, 2, 0, 0).getTime());    // Sat 02:00 -> recycle #2
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], undefined, "recycles again at the next day's 02:00");
});

test("the 18h ceiling still fires when it comes before the next 02:00", async () => {
  const { ctx } = await loadApp({ seed: 449 });
  ctx.addTask("Benchmark", false);
  const skip = ctx.addTask("Skip me", false);
  setFakeTime(ctx, new Date(2026, 7, 28, 7, 0, 0).getTime());    // Fri 07:00 — next 02:00 is 19h out, 18h ceiling is 18h out
  ctx.startScan();
  ctx.state.considered[skip.id] = "no";

  setFakeTime(ctx, new Date(2026, 7, 29, 0, 30, 0).getTime());   // Sat 00:30 — 17.5h in, Sat 02:00 not yet reached
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], "no", "17.5h in and 02:00 not reached — stands");

  setFakeTime(ctx, new Date(2026, 7, 29, 1, 0, 0).getTime());    // Sat 01:00 — exactly 18h in, still before 02:00
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[skip.id], undefined, "the 18h ceiling trips an hour before the day line would have");
});

/* ---------- chain start: one click, then the oldest outstanding task is dotted ----------
   Starting a chain has no benchmark, so a ranked pick and a Yes/No comparison
   are both meaningless — and so is asking "can I do this?", because the answer
   changes nothing about which task goes first. So nothing is dotted while you
   are still adding: the scan waits behind a Start scanning button, and that
   click dots the oldest outstanding task. That first dot moves no ranks —
   nothing was compared. */

function addTaskAged(ctx, title, ageMs) { // add a task with a backdated createdAt
  const t = ctx.addTask(title, false);
  ctx.state.tasks.find((x) => x.id === t.id).createdAt = Date.now() - ageMs;
  return t;
}
const titleOf = (ctx, id) => (ctx.state.tasks.find((t) => t.id === id) || {}).title;
const scanHtmlOf = (ctx, shim) => { ctx.render(); return shim.elements.get("scan").innerHTML; };

test("chain start: nothing is dotted while you're still adding tasks", async () => {
  const { ctx } = await loadApp({ seed: 79 });
  addTaskAged(ctx, "Newest", 1000);
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Middle", 50000);

  assert.equal(ctx.state.mode, "scan");
  assert.equal(ctx.state.chain.length, 0, "adding a task must not start a chain by itself");
  assert.equal(ctx.state.candidateId, null, "and no candidate is dealt with nothing to compare it against");
});

test("chain start: Start scanning dots the OLDEST outstanding task", async () => {
  const { ctx } = await loadApp({ seed: 80 });
  addTaskAged(ctx, "Newest", 1000);
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Middle", 50000);

  ctx.startScan();
  assert.equal(ctx.state.chain.length, 1);
  assert.equal(titleOf(ctx, ctx.state.chain[0]), "Oldest");
});

test("chain start: the candidate offered is a ranked pick from what's left, never the task just dotted", async () => {
  const { ctx } = await loadApp({ seed: 88 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Second oldest", 800000);
  const strong = addTaskAged(ctx, "Newest but top-ranked", 1000);
  const st = ctx.state.tasks.find((t) => t.id === strong.id);
  st.mu = 500; st.sigma = 0.5;   // overwhelmingly the highest-ranked task
  ctx.recomputeRanks();

  ctx.startScan();
  assert.equal(titleOf(ctx, ctx.state.chain[0]), "Oldest", "the dot itself goes by age");
  assert.equal(ctx.state.candidateId, strong.id, "ranked scanning starts immediately, against the task just dotted");
});

test("chain start: a strong rank does NOT jump the queue ahead of the oldest task", async () => {
  const { ctx } = await loadApp({ seed: 81 });
  addTaskAged(ctx, "Oldest but weak", 900000);
  const strong = addTaskAged(ctx, "Newer but top-ranked", 1000);
  const st = ctx.state.tasks.find((t) => t.id === strong.id);
  st.mu = 500; st.sigma = 0.5;
  ctx.recomputeRanks();

  ctx.startScan();
  assert.equal(titleOf(ctx, ctx.state.chain[0]), "Oldest but weak", "ranking must not influence the first dot");
});

test("chain start: the first dot moves NO ranks (mu/sigma untouched for every task)", async () => {
  const { ctx } = await loadApp({ seed: 83 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  const before = ctx.state.tasks.map((t) => ({ id: t.id, mu: t.mu, sigma: t.sigma }));

  ctx.startScan();
  assert.equal(ctx.state.chain.length, 1, "precondition: the first dot landed");
  for (const snap of before) {
    const now = ctx.state.tasks.find((t) => t.id === snap.id);
    assert.equal(now.mu, snap.mu, `mu for ${now.title} should be unchanged by the first dot`);
    assert.equal(now.sigma, snap.sigma, `sigma for ${now.title} should be unchanged by the first dot`);
  }
});

test("chain start: a fresh can't mark keeps a task out of the first dot", async () => {
  const { ctx } = await loadApp({ seed: 84 });
  addTaskAged(ctx, "Newest", 1000);
  addTaskAged(ctx, "Second oldest", 500000);
  const first = addTaskAged(ctx, "First oldest", 900000);
  ctx.state.considered[first.id] = "cant";
  ctx.state.cantAt[first.id] = Date.now();

  ctx.startScan();
  assert.equal(titleOf(ctx, ctx.state.chain[0]), "Second oldest",
    "a can't mark is bulletproof — it must not be overridden by dotting the task outright");
});

test("chain start: an ineligible task is never dotted, however old it is", async () => {
  const { ctx } = await loadApp({ seed: 96 });
  const future = addTaskAged(ctx, "Starts next week", 900000);   // the oldest, but not startable yet
  ctx.state.tasks.find((x) => x.id === future.id).startsAt = ctx.todayISO(7);
  const ready = addTaskAged(ctx, "Ready now", 1000);

  ctx.startScan();
  assert.deepEqual([...ctx.state.chain], [ready.id], "age must not override eligibility");
});

test("chain start: Start scanning with nothing eligible leaves the chain empty and doesn't throw", async () => {
  const { ctx } = await loadApp({ seed: 97 });
  ctx.startScan();
  assert.equal(ctx.state.chain.length, 0);
  assert.equal(ctx.state.candidateId, null);
  assert.equal(ctx.state.mode, "scan", "the button still puts you in scanning mode, just with nothing to dot");
});

test("chain start: Start scanning from a paused queue resumes and dots in the one click", async () => {
  const { ctx } = await loadApp({ seed: 98 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.onAction("start-working", {});
  assert.equal(ctx.state.mode, "work");

  ctx.onAction("start-scan", {});
  assert.equal(ctx.state.mode, "scan", "one click, not two");
  assert.equal(titleOf(ctx, ctx.state.chain[0]), "Oldest");
});

test("crossing off the last dot empties the chain and hands back the Start scanning button", async () => {
  const { ctx, shim } = await loadApp({ seed: 210 });
  const oldest = addTaskAged(ctx, "Oldest outstanding", 900000);
  addTaskAged(ctx, "Newer", 300000);
  const dot = addTaskAged(ctx, "The only dot", 100000);
  ctx.state.chain = [dot.id];
  ctx.state.candidateId = null;

  ctx.doneTask(dot.id);
  assert.deepEqual([...ctx.state.chain], [], "the chain should be empty again");
  assert.equal(ctx.state.mode, "scan");
  assert.equal(ctx.state.candidateId, null, "no candidate is dealt with nothing dotted");
  assert.match(scanHtmlOf(ctx, shim), /data-act="start-scan"/, "you're offered the start of a fresh chain");

  ctx.startScan();
  assert.deepEqual([...ctx.state.chain], [oldest.id], "which starts on the oldest outstanding task, as ever");
});

test("Can't on the only dotted task goes back to Start scanning, and doesn't re-dot the one you refused", async () => {
  const { ctx } = await loadApp({ seed: 95 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Second oldest", 800000);
  ctx.startScan();
  const refused = ctx.state.chain[0];
  assert.equal(titleOf(ctx, refused), "Oldest");

  ctx.benchCant();
  assert.equal(ctx.state.considered[refused], "cant");
  assert.equal(ctx.state.chain.length, 0, "nothing is dotted behind your back");

  ctx.startScan();
  assert.equal(titleOf(ctx, ctx.state.chain[0]), "Second oldest");
});

test("deleting the only dotted task goes back to Start scanning", async () => {
  const { ctx } = await loadApp({ seed: 87 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Second oldest", 500000);
  ctx.startScan();
  const dotted = ctx.state.chain[0];

  ctx.deleteTask(dotted);
  assert.equal(ctx.state.tasks.some((t) => t.id === dotted), false);
  assert.equal(ctx.state.chain.length, 0);

  ctx.startScan();
  assert.equal(titleOf(ctx, ctx.state.chain[0]), "Second oldest");
});

test("decide('can') is retired — a stale 'can' must not dot anything or drop the candidate", async () => {
  const { ctx } = await loadApp({ seed: 93 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.startScan();
  const chainBefore = [...ctx.state.chain];
  const cand = ctx.state.candidateId;

  ctx.decide("can");
  assert.deepEqual([...ctx.state.chain], chainBefore, "'can' is no longer a decision — it must not extend the chain");
  assert.equal(ctx.state.candidateId, cand, "and it must not swap the candidate out either");
});

test("no code path dispatches a 'can' decision any more", () => {
  assert.ok(!/data-act="can"/.test(html), "the Can button should be gone from the markup");
  assert.ok(!/decide\("can"\)/.test(appSrc), "nothing should call decide('can')");
  assert.ok(!/case "can":/.test(appSrc), "the action dispatch should no longer route 'can'");
});

test("yes/no still need a benchmark: with nothing dotted they are refused outright", async () => {
  const { ctx } = await loadApp({ seed: 85 });
  addTaskAged(ctx, "Oldest", 900000);
  const newer = addTaskAged(ctx, "Newer", 1000);
  ctx.state.candidateId = newer.id;   // nothing is dotted, so this shouldn't be reachable — force it anyway

  ctx.decide("yes");
  assert.equal(ctx.state.chain.length, 0, "'yes' has nothing to compare against and must not dot");

  ctx.decide("no");
  assert.equal(ctx.state.considered[newer.id], undefined, "'no' must not mark the task considered either");
});

test("UI: with nothing dotted the scan offers Start scanning — no benchmark, no candidate, no decide row", async () => {
  const { ctx, shim } = await loadApp({ seed: 90 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  const scanHtml = scanHtmlOf(ctx, shim);

  assert.match(scanHtml, /<button class="btn primary" data-act="start-scan">Start scanning<\/button>/,
    `expected a Start scanning button in: ${scanHtml}`);
  assert.ok(!/class="card bench"/.test(scanHtml), "nothing has gone purple yet");
  assert.ok(!/class="card cand"/.test(scanHtml), "and no candidate is offered yet");
  assert.ok(!/class="decide"/.test(scanHtml), "so there's no decide row either");
});

test("UI: once scanning starts it's Yes/No — no Can button, no chain-start question", async () => {
  const { ctx, shim } = await loadApp({ seed: 91 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.startScan();
  const scanHtml = scanHtmlOf(ctx, shim);

  assert.ok(!/data-act="start-scan"/.test(scanHtml), "the Start scanning button has done its job and gone");
  assert.match(scanHtml, /class="card bench"/, "the dotted task is the benchmark now");
  assert.match(scanHtml, /data-act="yes"/, "Yes is offered against it");
  assert.match(scanHtml, /data-act="no"/, "so is No");
  assert.ok(!/data-act="can"/.test(scanHtml), "the Can button is gone");
  assert.ok(!/Starting a chain/.test(scanHtml), "so is the chain-start question line");
  assert.match(scanHtml, /Would I rather/, "the comparison question is asked from the very first decision");
  assert.match(scanHtml, /data-act="cant"/, "Can't still skips a candidate");
  assert.match(scanHtml, /data-act="cand-done"/, "Done should still be available");
  assert.match(scanHtml, /data-act="delete-task"/, "Delete should still be available");
});

test("UI: help describes Start scanning rather than a Can/Can't step", async () => {
  const { ctx, shim } = await loadApp({ seed: 94 });
  ctx.openHelp();
  const helpHtml = shim.elements.get("modalRoot").innerHTML;

  assert.match(helpHtml, /Start scanning/, "help should name the button that starts a chain");
  assert.match(helpHtml, /oldest outstanding task/, "the rule itself hasn't changed — oldest first");
  assert.ok(!/Answer <b>Can<\/b>/.test(helpHtml), "the Can/Can't instruction should be gone");
});

/* ---------- Reveal -> direct Edit on the benchmark/candidate cards ----------
   These two siderail buttons used to scroll-and-flash the task in the
   (possibly collapsed) All-tasks list. That's now a direct Edit button, same
   action as clicking a title in the list. The chain breadcrumb crumbs reuse
   the old reveal-in-list behavior on purpose — they show the task's own
   title, not a "Reveal" label, so they're a different affordance and stay
   as-is. */

test("UI: the benchmark card shows a direct Edit button, not Reveal", async () => {
  const { ctx, shim } = await loadApp({ seed: 92 });
  const t = ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.match(scanHtml, new RegExp(`data-act="edit" data-id="${t.id}"`));
  assert.match(scanHtml, />Edit</);
  assert.ok(!/data-act="reveal"/.test(scanHtml), "Reveal must be gone from the benchmark card");
  assert.ok(!/>Reveal</.test(scanHtml));
});

test("UI: the candidate card shows a direct Edit button, not Reveal", async () => {
  const { ctx, shim } = await loadApp({ seed: 93 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.startScan();
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;
  const cand = ctx.state.candidateId;

  assert.match(scanHtml, new RegExp(`data-act="edit" data-id="${cand}"`));
  assert.ok(!/data-act="reveal"/.test(scanHtml), "Reveal must be gone from the candidate card");
  assert.ok(!/>Reveal</.test(scanHtml));
});

test("UI: clicking the benchmark's Edit button opens the edit pane for that task", async () => {
  const { ctx, shim } = await loadApp({ seed: 94 });
  const t = ctx.addTask("Dotted task", true);

  ctx.onAction("edit", { dataset: { id: t.id } });
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, /Edit task/);
  assert.match(html, /value="Dotted task"/);
});

test("UI: the chain breadcrumb still reveals-in-list (untouched by the Edit swap)", async () => {
  const { ctx, shim } = await loadApp({ seed: 95 });
  const first = ctx.addTask("First dot", true);
  ctx.addTask("Second dot", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.match(scanHtml, new RegExp(`class="crumb" data-act="reveal" data-id="${first.id}"`));
  assert.match(scanHtml, />First dot</, "the crumb shows the task's own title, not the word Edit");
});

/* ---------- benchmark card: no redundant dot, full-size "Worked on it" ----------
   The card already reads as the benchmark (purple fill, "Done" checkbox, its
   position in the layout), so the little filled circle beside the title was
   saying nothing the card didn't already say. "Worked on it" was a small
   underlined text link next to full-size Dislodge/Delete buttons despite being
   an equally consequential action; it's now a peer-sized button. */

test("UI: the benchmark card no longer renders the redundant dot circle", async () => {
  const { ctx, shim } = await loadApp({ seed: 96 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.ok(!/class="dot"/.test(scanHtml), `the dot span should be gone from: ${scanHtml}`);
  assert.match(scanHtml, /data-act="bench-done"/, "the Done control must survive");
  assert.match(scanHtml, />Dotted task</, "and so must the title");
});

/* ---------- Done and Edit join the rest of the buttons ----------
   Done was a checkbox inside the card on the left; Edit was a bare underlined
   text link. Both are now buttons in the right-hand siderail, sized like
   Dislodge and its neighbours — Done green, since it's the completion. */

test("UI: the benchmark card's Done is a green button among its actions, not a card checkbox", async () => {
  const { ctx, shim } = await loadApp({ seed: 250 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.ok(!/class="ckbox"/.test(scanHtml), `no checkbox should remain in: ${scanHtml}`);
  assert.ok(!/class="donepick"/.test(scanHtml), "the card-side Done label should be gone");
  assert.match(scanHtml, /<button class="btn sm done" data-act="bench-done"/,
    "Done should be a peer-sized button carrying the green .done fill");
  assert.match(scanHtml, /data-act="bench-done"[^>]*>[^<]*Done<span class="keyhint">d<\/span>/,
    "and it should keep its d keyhint");
});

test("UI: the candidate card's Done gets the same button treatment", async () => {
  const { ctx, shim } = await loadApp({ seed: 251 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.startScan();
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.ok(!/class="ckbox"/.test(scanHtml), "the candidate card should not keep a checkbox either");
  assert.match(scanHtml, /<button class="btn sm done" data-act="cand-done"/);
});

test("UI: Edit renders as a button rather than a bare text link", async () => {
  const { ctx, shim } = await loadApp({ seed: 252 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.ok(!/class="editlink"/.test(scanHtml), `Edit should no longer be a text link in: ${scanHtml}`);
  assert.match(scanHtml, /<button class="btn sm subtle" data-act="edit"/);
});

test("UI: every action button in the candidate's siderail shares the same .sm sizing", async () => {
  const { ctx, shim } = await loadApp({ seed: 253 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.startScan();
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  const rails = scanHtml.match(/<div class="siderail[^"]*">[\s\S]*?<\/div>/g) || [];
  assert.equal(rails.length, 1, `only the candidate keeps a rail; found ${rails.length}`);
  const btns = rails[0].match(/<button class="btn [^"]*"/g) || [];
  assert.equal(btns.length, 3, `expected Done/Edit/Delete, found ${btns.length} in ${rails[0]}`);
  const odd = btns.filter((b) => !/\bsm\b/.test(b));
  assert.deepEqual(odd, [], "a siderail button without .sm would render a different size than its neighbours");
});

test("UI: the benchmark's d/⌫ keyhints hide when a candidate is showing", async () => {
  const { ctx, shim } = await loadApp({ seed: 260 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.addTask("Third task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  // benchmark card and candidate card both present
  assert.ok(scanHtml.includes('data-act="bench-done"'), "benchmark Done button should render");
  assert.ok(scanHtml.includes('data-act="cand-done"'), "candidate Done button should render");

  // the benchmark's actions are a row beneath its card; the candidate keeps a rail
  const benchmarkSiderail = benchAction(scanHtml);
  assert.ok(benchmarkSiderail, "the benchmark should have its action row");
  const siderails = scanHtml.match(/<div class="siderail[^"]*">[\s\S]*?<\/div>/g) || [];
  assert.equal(siderails.length, 1, "only the candidate should have a siderail");
  const candidateSiderail = siderails[0];

  // benchmark's Done should NOT have the d keyhint when candidate is showing
  assert.ok(!benchmarkSiderail.includes('data-act="bench-done"') || !benchmarkSiderail.includes('<span class="keyhint">d</span>'),
    "benchmark's Done should not show d keyhint when candidate is present");

  // benchmark's Delete should NOT have the ⌫ keyhint when candidate is showing
  assert.ok(!benchmarkSiderail.includes('Delete') || !benchmarkSiderail.includes('<span class="keyhint">⌫</span>'),
    "benchmark's Delete should not show ⌫ keyhint when candidate is present");

  // candidate's Done SHOULD have the d keyhint
  assert.ok(candidateSiderail.includes('data-act="cand-done"') && candidateSiderail.includes('<span class="keyhint">d</span>'),
    "candidate's Done should show d keyhint");
});

test("UI: benchmark's action row is full opacity in work mode (not greyed)", async () => {
  const { ctx, shim } = await loadApp({ seed: 261 });
  ctx.addTask("Task", true);
  ctx.onAction("start-working", {});
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  // In work mode, the action row should NOT have the disabled class (full opacity)
  const benchmarkSiderail = benchAction(scanHtml);
  assert.ok(benchmarkSiderail, "the benchmark should have its action row in work mode");
  assert.ok(!/class="actionrow[^"]*disabled/.test(benchmarkSiderail), 
    "the action row should NOT be greyed out in work mode — actions are relevant here");

  // benchmark's Done SHOULD have the d keyhint when no candidate is showing
  assert.ok(benchmarkSiderail.includes('data-act="bench-done"') && benchmarkSiderail.includes('<span class="keyhint">d</span>'),
    "benchmark's Done should show d keyhint when no candidate is present");

  // benchmark's Delete SHOULD have the ⌫ keyhint when no candidate is showing
  assert.ok(benchmarkSiderail.includes('Delete') && benchmarkSiderail.includes('<span class="keyhint">⌫</span>'),
    "benchmark's Delete should show ⌫ keyhint when no candidate is present");
});

/* ---------- work mode: actions are greyed but still work ----------
   When you hit "done adding for now" and mode flips to work, the benchmark
   card stays on screen with its actions, but they're dimmed to show you're
   in a different phase. Hovering restores them to full brightness to confirm
   they're still clickable — you can still change your mind mid-queue. */

test("UI: benchmark's action row is greyed out (lowered opacity) during scanning", async () => {
  const { ctx, shim } = await loadApp({ seed: 280 });
  ctx.addTask("Dotted task", true);
  ctx.addTask("Another task", false);
  ctx.render();
  const row = shim.elements.get("scan").innerHTML.match(/<div class="actionrow[^"]*">([\s\S]*?)<\/div>/)[0];

  assert.match(row, /class="actionrow[^"]*disabled/, `action row should carry the disabled class during scan, got: ${row}`);
});

test("CSS: .actionrow.disabled lowers opacity to show it's a different mode, but keeps it clickable", () => {
  const rule = styleSrc.match(/\.actionrow\.disabled\{([^}]*)\}/);
  assert.ok(rule, "there should be a .actionrow.disabled rule");
  const m = rule[1].match(/opacity:\s*([\d.]+)/);
  assert.ok(m && +m[1] < 1, `opacity should be < 1 to dim it, got: ${rule[1]}`);
  assert.ok(!/pointer-events:\s*none/.test(rule[1]), "pointer-events should not be none — actions stay clickable");
});

test("CSS: hovering over a disabled action row restores full opacity", () => {
  const rule = styleSrc.match(/\.actionrow\.disabled:hover\{([^}]*)\}/);
  assert.ok(rule, "there should be a .actionrow.disabled:hover rule");
  assert.match(rule[1], /opacity:\s*1/, "opacity should return to 1 on hover");
});

test("UI: a greyed action row's buttons are still clickable — you can change your mind", async () => {
  const { ctx } = await loadApp({ seed: 281 });
  ctx.addTask("Task to undo", true);
  ctx.onAction("start-working", {});
  assert.equal(ctx.state.mode, "work");

  // In work mode, the benchmark's action row is greyed but still works
  // Clicking bench-done on a greyed row should complete the task as usual
  ctx.onAction("bench-done", {});
  assert.ok(ctx.state.tasks[0].done, "the greyed button should still trigger the action");
});

/* ---------- new tasks show they'll join the chain ----------
   When you're adding tasks and haven't started scanning yet, each one you add
   gets a small arrow indicator → pointing at the scan start button, showing
   the next click will grab one of them. */

test("UI: a new task shows an arrow → to the Start scanning button when nothing's dotted yet", async () => {
  const { ctx, shim } = await loadApp({ seed: 282 });
  ctx.addTask("Will be grabbed", false);
  ctx.state.listOpen = true;
  ctx.render();
  const list = shim.elements.get("listBody").innerHTML;

  assert.match(list, /→/, `expected an arrow indicator, got: ${list}`);
});

test("UI: the arrow disappears once scanning starts and a task is dotted", async () => {
  const { ctx, shim } = await loadApp({ seed: 283 });
  ctx.addTask("Will be grabbed", false);
  ctx.state.listOpen = true;
  ctx.render();
  let list = shim.elements.get("listBody").innerHTML;
  assert.match(list, /→/, "precondition: arrow is showing before scan");

  ctx.startScan();
  ctx.render();
  list = shim.elements.get("listBody").innerHTML;
  assert.ok(!/→/.test(list), "arrow should disappear once a task is dotted");
});

/* ---------- undo advertises its key like every other keyboard control ----------
   Undo has always had a `u` hotkey, but the only place that said so was the
   tooltip — so the one control you reach for in a hurry was the one you had to
   hover to learn. It carries the same keyhint glyph as Yes/No/Done/Delete. */

test("UI: the undo button carries its u keyhint glyph", () => {
  const m = html.match(/<button class="ghost" data-act="undo"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(m, "the undo button should still be a ghost button in the header");
  assert.match(m[1], /<span class="keyhint">u<\/span>/,
    `expected a u keyhint glyph inside the undo button, got: ${m[1]}`);
});

test("UI: undo's keyhint glyph sits after its label, as it does on every other keyboard button", () => {
  const m = html.match(/<button class="ghost" data-act="undo"[^>]*>([\s\S]*?)<\/button>/);
  assert.match(m[1], /^[^<]*\S[^<]*<span class="keyhint">u<\/span>$/,
    `the glyph should trail the label with nothing after it, got: ${m[1]}`);
});

test("UI: undo's tooltip still names the key, so glyph and tooltip agree", () => {
  const m = html.match(/<button class="ghost" data-act="undo"([^>]*)>/);
  assert.match(m[1], /title="[^"]*\(u\)"/, `expected the key named in the tooltip, got: ${m[1]}`);
});

test("undo: the header button reverses the last action through the normal onAction path", async () => {
  const { ctx } = await loadApp({ seed: 256 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.startScan();
  assert.equal(ctx.state.chain.length, 1);

  ctx.onAction("undo", { dataset: {} });
  assert.equal(ctx.state.chain.length, 0, "the button should take the first dot back, same as the u key");
});

/* ---------- the benchmark's actions are one row beneath the card ----------
   Six actions stacked in a right-hand rail made the purple card as tall as the
   rail and pushed the candidate card down past it. They now sit in a single
   row directly beneath the card they act on, and a hairline separates that
   whole block from the candidate being compared against it — so the two things
   you're weighing read as two things, not one long column. */

const benchAction = (scanHtml) => (scanHtml.match(/<div class="actionrow[^"]*">[\s\S]*?<\/div>/) || [])[0];

test("UI: the benchmark's six actions sit in one row beneath the purple card", async () => {
  const { ctx, shim } = await loadApp({ seed: 270 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  const rows = scanHtml.match(/<div class="actionrow[^"]*">/g) || [];
  assert.equal(rows.length, 1, `expected exactly one action row, found ${rows.length} in: ${scanHtml}`);

  const row = benchAction(scanHtml);
  const acts = [...row.matchAll(/data-act="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(acts, ["bench-done", "edit", "worked", "bench-cant", "dislodge", "delete-task"],
    "all six actions, in the order they were in the rail");
});

test("UI: the action row comes after the purple card, not beside it", async () => {
  const { ctx, shim } = await loadApp({ seed: 271 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.ok(scanHtml.indexOf('class="card bench"') < scanHtml.indexOf('class="actionrow'),
    "the row should follow the card in the markup, so it renders beneath it");
  assert.ok(!/class="cardrow"><div class="card bench"/.test(scanHtml),
    "the benchmark should no longer be laid out as a side-by-side card row");
});

test("UI: no siderail hangs off the benchmark card any more", async () => {
  const { ctx, shim } = await loadApp({ seed: 272 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.ok(!/class="siderail"/.test(scanHtml),
    `nothing but a benchmark is showing, so no siderail should remain in: ${scanHtml}`);
});

test("UI: every action in the benchmark's row shares the same .sm sizing", async () => {
  const { ctx, shim } = await loadApp({ seed: 273 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const row = benchAction(shim.elements.get("scan").innerHTML);

  const btns = row.match(/<button class="btn [^"]*"/g) || [];
  assert.equal(btns.length, 6, `expected six buttons, found ${btns.length} in ${row}`);
  const odd = btns.filter((b) => !/\bsm\b/.test(b));
  assert.deepEqual(odd, [], "a button without .sm would render a different size than its neighbours");
});

test("UI: a separator sits between the benchmark block and the candidate card", async () => {
  const { ctx, shim } = await loadApp({ seed: 274 });
  addTaskAged(ctx, "Oldest", 900000);
  addTaskAged(ctx, "Newer", 1000);
  ctx.startScan();
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  const seps = scanHtml.match(/class="sep"/g) || [];
  assert.equal(seps.length, 1, `expected exactly one separator, found ${seps.length} in: ${scanHtml}`);
  assert.ok(scanHtml.indexOf('class="actionrow"') < scanHtml.indexOf('class="sep"'),
    "the separator comes after the benchmark's actions");
  assert.ok(scanHtml.indexOf('class="sep"') < scanHtml.indexOf('class="card cand"'),
    "and before the candidate card it separates them from");
});

test("UI: no separator is drawn when there's no candidate beneath it", async () => {
  const { ctx, shim } = await loadApp({ seed: 275 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  assert.ok(!/class="sep"/.test(shim.elements.get("scan").innerHTML),
    "a rule with nothing under it is just a stray line");

  ctx.onAction("start-working", {});   // benchmark still dotted, but scanning paused
  ctx.render();
  assert.ok(!/class="sep"/.test(shim.elements.get("scan").innerHTML),
    "the paused notice isn't a candidate either");
});

test("CSS: the separator is a hairline drawn from a theme token, not a hardcoded grey", () => {
  const rule = styleSrc.match(/\.sep\{([^}]*)\}/);
  assert.ok(rule, "there should be a .sep rule");
  const m = rule[1].match(/border-top:\s*1px solid var\((--[a-z-]+)\)/);
  assert.ok(m, `the line should be a 1px border in a theme token, got: ${rule[1]}`);

  const tokens = themeTokens();
  assert.ok(tokens.light[m[1]], `${m[1]} must be defined as a light-dark() pair`);
  assert.notEqual(tokens.light[m[1]], tokens.dark[m[1]],
    "a separator that doesn't change between themes is hardcoded in all but name");
});

test("CSS: every button reserves the same 1px border, so a row of them lines up", () => {
  // .subtle is the only button with a visible border. In the old vertical rail
  // its extra 2px went unnoticed; in a row beside five filled buttons it reads
  // as one button sitting proud of its neighbours.
  const base = styleSrc.match(/\.btn\{([^}]*)\}/);
  assert.ok(base, "there should be a .btn rule");
  assert.match(base[1], /border:1px solid transparent/,
    `every button needs the border reserved, not just the one that paints it: ${base[1]}`);

  const subtle = styleSrc.match(/\.btn\.subtle\{([^}]*)\}/);
  assert.ok(subtle, "there should be a .btn.subtle rule");
  assert.match(subtle[1], /border:1px solid var\(--line\)/, "which .subtle then recolours");
});

/* ---------- header and footer carry less ----------
   The tagline restated the README at the user, and the footer listed the keys
   that every button now prints on itself. */

test("UI: the header carries the title alone, without the tagline", () => {
  assert.ok(!/ranked FVP — dot, compare, execute/.test(html), "the tagline should be gone from the header");
  assert.ok(!/class="sub"/.test(html), "and its span with it");
  assert.match(html, /<h1>Chain Scanner<\/h1>/, "the title itself stays");
});

test("CSS: the retired .sub style is gone too", () => {
  assert.ok(!/\.sub\{/.test(styleSrc) && !/\.titles \.sub\{/.test(styleSrc),
    "a style with no element left to match is dead weight");
});

test("UI: the footer no longer lists the keys, which every button now prints on itself", () => {
  const foot = html.match(/<footer class="foot">([\s\S]*?)<\/footer>/);
  assert.ok(foot, "the footer should still be there");
  assert.ok(!/keys:/i.test(foot[1]), `the keys legend should be gone from: ${foot[1]}`);
  assert.ok(!/y \/ n \/ c/.test(foot[1]), "including the glyph list itself");
  assert.match(foot[1], /Final Version Perfected/, "the attributions stay");
  assert.match(foot[1], /spawelo/, "both of them");
  assert.match(foot[1], /data-act="cycle-theme"/, "and the theme toggle stays where it is");
});

/* The two Done controls used to be routed through a `change` listener because
   they were checkboxes, and the click handler explicitly skipped them. As
   buttons they go through onAction like everything else. */

test("bench-done: completes the benchmark through the normal onAction path", async () => {
  const { ctx } = await loadApp({ seed: 254 });
  const t = ctx.addTask("Dotted task", true);

  ctx.onAction("bench-done", { dataset: {} });
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, true);
  assert.equal(ctx.state.chain.includes(t.id), false);
});

test("cand-done: completes the candidate through the normal onAction path", async () => {
  const { ctx } = await loadApp({ seed: 255 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.startScan();
  const cand = ctx.state.candidateId;

  ctx.onAction("cand-done", { dataset: {} });
  assert.equal(ctx.state.tasks.find((x) => x.id === cand).done, true);
});

test("the header's decorative purple dot is gone", () => {
  assert.ok(!/class="mark"/.test(html), "the ◉ glyph beside the title should be removed");
  assert.ok(!/\.mark\{/.test(html), "and its now-unused rule with it");
  assert.match(html, /<h1>Chain Scanner<\/h1>/, "the title itself stays");
});

test("the click handler no longer special-cases the two Done controls", () => {
  assert.ok(!/handled on change/.test(html),
    "the checkbox-era click bypass should be gone now that Done is a button");
  assert.ok(!/\[data-act="bench-done"\]'\)\)\{ if\(el\.checked\)/.test(html),
    "and so should its change-event handler");
});

test("UI: 'Worked on it' renders as a full-size button, like Dislodge and Delete", async () => {
  const { ctx, shim } = await loadApp({ seed: 97 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.match(scanHtml, /class="btn sm worked" data-act="worked"/,
    "it should carry the same .btn sizing as its neighbours");
  assert.ok(!/class="sidesm" data-act="worked"/.test(scanHtml),
    "the old small text-link styling should be gone");
});

/* =====================================================================
   MARKING A TASK DONE FROM THE EDIT PANE
   The edit modal could rename, re-context, or delete a task, but not cross it
   off — completion was only reachable from the benchmark card, the candidate
   card, or the `d` key. doneTask(id) closes that gap for any task, anywhere.
   Deliberately NOT a mode change: unlike benchDone(), crossing something off
   from the edit pane says nothing about whether you're still scanning.
   ===================================================================== */

test("doneTask: completes a plain open task and drops it out of the open list", async () => {
  const { ctx } = await loadApp({ seed: 200 });
  const t = ctx.addTask("Write the next Carmine scene", false);
  ctx.doneTask(t.id);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.done, true);
  assert.ok(task.completedAt, "completedAt should be stamped");
  assert.equal(ctx.state.tasks.filter((x) => !x.done).length, 0);
});

test("doneTask: a dotted task leaves the chain, and scanning mode is left alone", async () => {
  const { ctx } = await loadApp({ seed: 201 });
  const t = ctx.addTask("Dotted task", true);
  ctx.addTask("Other task", false);
  assert.equal(ctx.state.chain.length, 1);

  ctx.doneTask(t.id);
  assert.equal(ctx.state.chain.includes(t.id), false, "a completed task must not stay dotted");
  assert.equal(ctx.state.mode, "scan", "the edit pane says nothing about whether you're done scanning");
});

test("doneTask: a MID-chain task is removed without disturbing the benchmark", async () => {
  const { ctx } = await loadApp({ seed: 202 });
  const first = ctx.addTask("First dot", true);
  const second = ctx.addTask("Second dot", true);
  assert.equal(ctx.benchmark().id, second.id);

  ctx.doneTask(first.id);
  assert.deepEqual([...ctx.state.chain], [second.id]);
  assert.equal(ctx.benchmark().id, second.id, "the head of the chain shouldn't move");
});

test("doneTask: completing the current candidate clears it and a fresh one is dealt", async () => {
  const { ctx } = await loadApp({ seed: 203 });
  addTaskAged(ctx, "Task A", 900000);
  addTaskAged(ctx, "Task B", 600000);
  addTaskAged(ctx, "Task C", 300000);
  ctx.startScan();
  const cand = ctx.state.candidateId;
  assert.ok(cand);

  ctx.doneTask(cand);
  assert.notEqual(ctx.state.candidateId, cand);
  assert.ok(ctx.state.candidateId, "two tasks remain in the pool, so one should be offered");
});

test("doneTask: applies NO strength signal — no comparison was made", async () => {
  const { ctx } = await loadApp({ seed: 204 });
  ctx.addTask("Benchmark", true);
  const t = ctx.addTask("Crossed off from the edit pane", false);
  const before = ctx.state.tasks.map((x) => ({ id: x.id, mu: x.mu, sigma: x.sigma }));

  ctx.doneTask(t.id);
  const after = ctx.state.tasks.map((x) => ({ id: x.id, mu: x.mu, sigma: x.sigma }));
  assert.deepEqual(after, before, "unlike cand-done, this must not score a win over the benchmark");
});

/* ---------- "repeats daily" is gone ----------
   The recurrence feature was removed. A task carrying a legacy recur:"daily"
   (from storage written by an older version, or a cloud sync from a device
   still on one) must degrade to an ordinary task rather than keep any of the
   old special-casing: no eligibility gate, no due-date bump on completion,
   no chip. Evergreen is a separate feature and stays. */

test("legacy recur:'daily' no longer gates eligibility", async () => {
  const { ctx } = await loadApp({ seed: 205 });
  const t = ctx.addTask("Daily walk", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.recur = "daily";
  task.lastDoneAt = realNow(ctx);   // "already done today" — used to make it ineligible

  assert.equal(ctx.isEligible(task, ctx.activeCtxSet()), true,
    "the daily gate is gone, so a legacy daily task scans like any other");
});

test("doneTask: a legacy daily task now completes permanently, with no due-date bump", async () => {
  const { ctx } = await loadApp({ seed: 219 });
  const t = ctx.addTask("Daily walk", false);
  ctx.state.tasks.find((x) => x.id === t.id).recur = "daily";

  ctx.doneTask(t.id);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.done, true, "it should cross off for good like any other task");
  assert.equal(task.due, null, "no tomorrow-bump — that was the daily behaviour");
  assert.equal(t.id in ctx.state.considered, false);
});

test("chipHTML: a legacy daily task renders no daily chip", async () => {
  const { ctx } = await loadApp({ seed: 220 });
  const t = ctx.addTask("Daily walk", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.recur = "daily";
  assert.doesNotMatch(ctx.chipHTML(task), /daily/i);
});

test("addTask: new tasks carry no recur field at all", async () => {
  const { ctx } = await loadApp({ seed: 221 });
  const t = ctx.addTask("Task A", false);
  assert.equal("recur" in ctx.state.tasks.find((x) => x.id === t.id), false);
});

test("UI: the edit pane no longer offers a 'repeats daily' checkbox", async () => {
  const { ctx, shim } = await loadApp({ seed: 222 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.ok(!/id="etDaily"/.test(html), `the daily checkbox should be gone from: ${html}`);
  assert.doesNotMatch(html, /repeats daily/i);
});

test("boot: a stored task carrying legacy recur:'daily' has the dead field stripped on load", async () => {
  const stored = {
    v: 1, tasks: [{
      id: "legacy1", title: "Daily walk", url: null, due: "2026-01-01", startsAt: null,
      evergreen: false, recur: "daily", ctx: [], mu: 25, sigma: 8.33,
      done: false, createdAt: 1, completedAt: null, lastDoneAt: null,
    }],
    contexts: [], chain: [], considered: {}, cantAt: {}, candidateId: null,
    interventionActive: false, interventionP: 0, snooze: 0,
    mode: "scan", decisionsMs: [], presentedAt: 0,
    listOpen: false, ctxOpen: true, histOpen: false, updatedAt: 5,
    settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, theme: "system" },
  };
  const { ctx } = await loadApp({ seed: 223, seedStorage: { "fvp:chain-scanner:v1": JSON.stringify(stored) } });

  const task = ctx.state.tasks.find((x) => x.id === "legacy1");
  assert.ok(task, "precondition: the stored task loaded");
  assert.equal("recur" in task, false, "the removed feature's flag should not ride along in exports/sync");
  assert.equal(task.title, "Daily walk", "nothing else about the task changes");
  assert.equal(task.due, "2026-01-01");
});

test("doneTask: an evergreen task stays open and starts its rest window", async () => {
  const { ctx } = await loadApp({ seed: 206 });
  const t = ctx.addTask("Tidy the desk", false);
  ctx.state.tasks.find((x) => x.id === t.id).evergreen = true;

  ctx.doneTask(t.id);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.done, false);
  assert.ok(task.lastDoneAt, "lastDoneAt drives the 90-minute evergreen rest");
  assert.equal(ctx.isEligible(task, ctx.activeCtxSet()), false);
});

test("doneTask: clears any considered mark and its can't timestamp", async () => {
  const { ctx } = await loadApp({ seed: 207 });
  const t = ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.state.considered[t.id] = "cant";
  ctx.state.cantAt[t.id] = realNow(ctx);

  ctx.doneTask(t.id);
  assert.equal(t.id in ctx.state.considered, false);
  assert.equal(t.id in ctx.state.cantAt, false, "no orphaned can't timestamp should linger");
});

test("doneTask: undo puts the task back, dot and all", async () => {
  const { ctx } = await loadApp({ seed: 208 });
  const t = ctx.addTask("Dotted task", true);
  ctx.doneTask(t.id);
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, true);

  ctx.undo();
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.done, false);
  assert.equal(task.completedAt, null);
  assert.deepEqual([...ctx.state.chain], [t.id], "undo should restore the dot too");
});

test("doneTask: an unknown, null, or undefined id is a safe no-op", async () => {
  const { ctx } = await loadApp({ seed: 209 });
  ctx.addTask("Task A", false);
  ctx.doneTask("no-such-id");
  ctx.doneTask(null);
  ctx.doneTask(undefined);
  assert.equal(ctx.state.tasks.filter((x) => !x.done).length, 1);
  assert.equal(ctx.state.tasks.filter((x) => x.done).length, 0);
});

test("UI: the edit pane renders a Done button carrying that task's id", async () => {
  const { ctx, shim } = await loadApp({ seed: 211 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, /data-act="done-task"/, `expected a done-task button in: ${html}`);
  assert.match(html, new RegExp(`data-act="done-task" data-id="${t.id}"`));
});

test("UI: the done-task action completes the task and closes the pane", async () => {
  const { ctx, shim } = await loadApp({ seed: 212 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  assert.notEqual(shim.elements.get("modalRoot").innerHTML, "");

  ctx.onAction("done-task", { dataset: { id: t.id } });
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, true);
  assert.equal(shim.elements.get("modalRoot").innerHTML, "", "the modal should close behind it");
  assert.match(shim.elements.get("histPanel").innerHTML, /\(1 entry\)/, "it should show up in History");
});

/* ---------- Done saves the pane's fields first ----------
   Delete throws unsaved edits away; Done doesn't. Retitle a task and cross it
   off in one motion and the completed task carries the new title. The two
   halves share a single undo snapshot, so one `u` reverses both. */

function fillEditPane(ctx, shim, { title, url, due, start, evergreen, ctxIds } = {}) {
  const g = (id) => ctx.document.getElementById(id);
  g("etTitle").value = title ?? "";
  g("etUrl").value = url ?? "";
  g("etDue").value = due ?? "";
  g("etStart").value = start ?? "";
  g("etEver").checked = !!evergreen;
  const picks = (ctxIds || []).map((id) => ({ checked: true, dataset: { editctx: id } }));
  shim.document.querySelectorAll = (sel) => (sel === "[data-editctx]" ? picks : []);
}

test("UI: the edit pane renders a Starts date input pre-filled with the task's startsAt", async () => {
  const { ctx, shim } = await loadApp({ seed: 308 });
  const t = ctx.addTask("Task A", false);
  ctx.state.tasks.find((x) => x.id === t.id).startsAt = "2026-09-10";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, /id="etStart"/, `expected a Starts input in: ${html}`);
  assert.match(html, /id="etStart"[^>]*value="2026-09-10"/);
});

test("UI: the edit pane's Starts input is empty when no startsAt is set", async () => {
  const { ctx, shim } = await loadApp({ seed: 309 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, /id="etStart"[^>]*value=""/);
});

test("save-edit: also applies the start date", async () => {
  const { ctx, shim } = await loadApp({ seed: 310 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Task A", start: "2026-10-01" });
  ctx.onAction("save-edit", { dataset: { id: t.id } });
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).startsAt, "2026-10-01");
});

test("save-edit: clearing the Starts field sets startsAt back to null", async () => {
  const { ctx, shim } = await loadApp({ seed: 311 });
  const t = ctx.addTask("Task A", false);
  ctx.state.tasks.find((x) => x.id === t.id).startsAt = "2026-10-01";
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Task A", start: "" });
  ctx.onAction("save-edit", { dataset: { id: t.id } });
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).startsAt, null);
});

test("done-task: also saves the start date before completing", async () => {
  const { ctx, shim } = await loadApp({ seed: 312 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Task A", start: "2026-11-05" });
  ctx.onAction("done-task", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.startsAt, "2026-11-05");
  assert.equal(task.done, true);
});

// Characterization test — this one passes BEFORE the refactor as well as after.
// Its job is to go red if pulling the field-reading into a shared helper breaks
// the Save path, which nothing else currently covers.
test("save-edit: still applies title, link, due, evergreen, and contexts, then closes the pane", async () => {
  const { ctx, shim } = await loadApp({ seed: 213 });
  const t = ctx.addTask("Old title", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "New title", url: "https://example.com/x", due: "2026-09-01", evergreen: true, ctxIds: ["c_home"] });

  ctx.onAction("save-edit", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "New title");
  assert.equal(task.url, "https://example.com/x");
  assert.equal(task.due, "2026-09-01");
  assert.equal(task.evergreen, true);
  assert.deepEqual([...task.ctx], ["c_home"]);
  assert.equal(shim.elements.get("modalRoot").innerHTML, "");
});

test("done-task: saves the title you just typed before crossing it off", async () => {
  const { ctx, shim } = await loadApp({ seed: 214 });
  const t = ctx.addTask("Old title", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Renamed on the way out" });

  ctx.onAction("done-task", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "Renamed on the way out", "Done must not discard the edit");
  assert.equal(task.done, true);
});

test("done-task: saves link, due date, and contexts too", async () => {
  const { ctx, shim } = await loadApp({ seed: 215 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { url: "https://example.com/receipt", due: "2026-09-02", ctxIds: ["c_home", "c_laptop"] });

  ctx.onAction("done-task", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.url, "https://example.com/receipt");
  assert.equal(task.due, "2026-09-02");
  assert.deepEqual([...task.ctx], ["c_home", "c_laptop"]);
});

test("done-task: ticking 'evergreen' in the pane makes it complete AS an evergreen", async () => {
  const { ctx, shim } = await loadApp({ seed: 216 });
  const t = ctx.addTask("Tidy the desk", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { evergreen: true });

  ctx.onAction("done-task", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.evergreen, true);
  assert.equal(task.done, false, "the field you just ticked decides HOW it completes");
  assert.ok(task.lastDoneAt, "it starts its rest window instead of crossing off for good");
  assert.equal(ctx.state.considered[t.id], "done");
});

test("done-task: the edit and the completion are ONE undo step", async () => {
  const { ctx, shim } = await loadApp({ seed: 217 });
  const t = ctx.addTask("Old title", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "New title" });
  ctx.onAction("done-task", { dataset: { id: t.id } });
  const saved = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(saved.title, "New title", "precondition: the edit was saved on the way out");
  assert.equal(saved.done, true, "precondition: and the task was completed");

  ctx.undo();
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.done, false, "one undo should reverse the completion");
  assert.equal(task.title, "Old title", "...and the edit that rode along with it");
});

/* =====================================================================
   "WORKED ON IT" FROM THE EDIT PANE
   Forster rule 7 — you started it, so cross it off and send it back to the
   bottom of the list. It was only reachable for the task at the head of the
   chain (the benchmark card's button). workedOnTask(id) generalizes it to any
   task, anywhere, mirroring what doneTask(id) already did for completion.
   Like Done, it saves the pane's fields on the way out and shares one undo
   snapshot with them.
   ===================================================================== */

// Characterization test — the benchmark-card path must keep working unchanged.
/* =====================================================================
   CAN'T ON THE BENCHMARK
   Dislodge takes a dotted task off the chain for good (for this pass).
   Can't takes it off too, but timestamps the mark so expireCants() puts it
   back on its own once the "Can't sticks for" window passes — the point being
   that circumstances change, and this task was refused for circumstance, not
   for worth. Neither touches rank: no "would I rather?" was answered.
   ===================================================================== */

test("benchCant: takes the benchmark off the chain and marks it 'cant' with a timestamp", async () => {
  const { ctx } = await loadApp({ seed: 240 });
  const t = ctx.addTask("Dotted task", true);
  ctx.benchCant();

  assert.equal(ctx.state.chain.includes(t.id), false, "it comes off the chain like a dislodge");
  assert.equal(ctx.state.considered[t.id], "cant");
  assert.ok(ctx.state.cantAt[t.id], "the timestamp is what lets it come back on its own");
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, false, "it is not completed");
});

test("benchCant: applies NO strength signal — it's a circumstance, not a comparison", async () => {
  const { ctx } = await loadApp({ seed: 241 });
  ctx.addTask("Dotted task", true);
  ctx.addTask("Other task", false);
  const before = ctx.state.tasks.map((x) => ({ id: x.id, mu: x.mu, sigma: x.sigma }));

  ctx.benchCant();
  const after = ctx.state.tasks.map((x) => ({ id: x.id, mu: x.mu, sigma: x.sigma }));
  assert.deepEqual(after, before, "no rank should move — that's the whole point versus Yes/No");
});

test("benchCant: the mark expires once cantMin passes, putting the task back in the scan", async () => {
  const { ctx } = await loadApp({ seed: 242 });
  ctx.state.settings.cantMin = 10;
  const t = ctx.addTask("Dotted task", true);
  ctx.addTask("Filler", false);

  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.benchCant();
  assert.ok(!ctx.pool().some((x) => x.id === t.id), "excluded right after being marked");

  setFakeTime(ctx, t0 + 5 * 60000);
  assert.ok(!ctx.pool().some((x) => x.id === t.id), "still excluded within the window");

  setFakeTime(ctx, t0 + 11 * 60000);
  ctx.ensureCandidate();   // any normal action re-checks expiry
  assert.ok(ctx.pool().some((x) => x.id === t.id), "back in the scan once the situation has had time to change");
  assert.equal(ctx.state.considered[t.id], undefined);
});

// The contrast that motivates having both actions.
test("dislodge: by contrast, does NOT expire — it stays skipped for the pass", async () => {
  const { ctx } = await loadApp({ seed: 243 });
  ctx.state.settings.cantMin = 10;
  const t = ctx.addTask("Dotted task", true);
  ctx.addTask("Filler", false);

  const t0 = realNow(ctx);
  setFakeTime(ctx, t0);
  ctx.dislodge();
  assert.equal(ctx.state.considered[t.id], "dislodged");
  assert.equal(ctx.state.cantAt[t.id], undefined, "a dislodge carries no expiry timestamp");

  setFakeTime(ctx, t0 + 60 * 60000);   // an hour later, far past any cantMin
  ctx.ensureCandidate();
  assert.equal(ctx.state.considered[t.id], "dislodged", "it should still be skipped");
});

test("benchCant: clears the intervention prompt, like dislodge does", async () => {
  const { ctx } = await loadApp({ seed: 244 });
  ctx.addTask("Dotted task", true);
  ctx.state.interventionActive = true;
  ctx.benchCant();
  assert.equal(ctx.state.interventionActive, false);
});

test("benchCant: a no-op when the chain is empty", async () => {
  const { ctx } = await loadApp({ seed: 245 });
  ctx.addTask("Undotted", false);
  assert.equal(ctx.state.chain.length, 0, "precondition: no benchmark");

  ctx.benchCant();
  assert.deepEqual(Object.keys(ctx.state.considered), [], "nothing should get marked");
});

test("benchCant: undo restores the dot and clears the mark", async () => {
  const { ctx } = await loadApp({ seed: 246 });
  const t = ctx.addTask("Dotted task", true);
  ctx.benchCant();
  assert.equal(ctx.state.considered[t.id], "cant", "precondition: it was marked");

  ctx.undo();
  assert.deepEqual([...ctx.state.chain], [t.id], "the dot comes back");
  assert.equal(t.id in ctx.state.considered, false);
  assert.equal(t.id in ctx.state.cantAt, false, "no orphaned timestamp left behind");
});

test("UI: the benchmark card offers Can't alongside Dislodge", async () => {
  const { ctx, shim } = await loadApp({ seed: 247 });
  ctx.addTask("Dotted task", true);
  ctx.render();
  const scanHtml = shim.elements.get("scan").innerHTML;

  assert.match(scanHtml, /data-act="bench-cant"/, `expected a bench-cant button in: ${scanHtml}`);
  assert.match(scanHtml, /data-act="dislodge"/, "Dislodge stays — they're different promises");
});

test("UI: the bench-cant action is wired up through onAction", async () => {
  const { ctx } = await loadApp({ seed: 248 });
  const t = ctx.addTask("Dotted task", true);

  ctx.onAction("bench-cant", { dataset: {} });
  assert.equal(ctx.state.considered[t.id], "cant");
  assert.equal(ctx.state.chain.includes(t.id), false);
});

test("UI: a benchmark marked Can't shows its countdown in the task list", async () => {
  const { ctx, shim } = await loadApp({ seed: 249 });
  ctx.state.settings.cantMin = 30;
  ctx.addTask("Dotted task", true);
  ctx.state.listOpen = true;

  ctx.benchCant();
  const listHtml = shim.elements.get("listBody").innerHTML;
  assert.match(listHtml, /can’t · \d+m/, `expected a countdown badge in: ${listHtml}`);
});

test("workedOn: crosses the benchmark off the chain and marks it 'worked'", async () => {
  const { ctx } = await loadApp({ seed: 230 });
  const t = ctx.addTask("Dotted task", true);
  ctx.workedOn();

  assert.equal(ctx.state.chain.includes(t.id), false, "it comes off the chain");
  assert.equal(ctx.state.considered[t.id], "worked");
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, false, "worked on it is not done");
});

test("UI: the edit pane renders a 'Worked on it' button carrying that task's id", async () => {
  const { ctx, shim } = await loadApp({ seed: 231 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;

  assert.match(html, new RegExp(`data-act="worked-task" data-id="${t.id}"`), `expected in: ${html}`);
  assert.match(html, /Worked on it/);
});

test("worked-task: marks the task 'worked' and closes the pane, without completing it", async () => {
  const { ctx, shim } = await loadApp({ seed: 232 });
  const t = ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.openEdit(t.id);

  ctx.onAction("worked-task", { dataset: { id: t.id } });
  assert.equal(ctx.state.considered[t.id], "worked");
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, false, "it must not cross off for good");
  assert.equal(shim.elements.get("modalRoot").innerHTML, "", "the modal should close behind it");
});

test("worked-task: removes the task from the chain wherever it sits, not just the head", async () => {
  const { ctx } = await loadApp({ seed: 233 });
  const buried = ctx.addTask("Buried dot", true);
  const head = ctx.addTask("Head dot", true);
  assert.deepEqual([...ctx.state.chain], [buried.id, head.id], "precondition: buried is under the head");

  ctx.openEdit(buried.id);
  ctx.onAction("worked-task", { dataset: { id: buried.id } });
  assert.deepEqual([...ctx.state.chain], [head.id], "only the worked task leaves the chain");
});

test("worked-task: saves the fields you just edited before marking it worked", async () => {
  const { ctx, shim } = await loadApp({ seed: 234 });
  const t = ctx.addTask("Old title", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Renamed on the way out", due: "2026-09-03" });

  ctx.onAction("worked-task", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "Renamed on the way out", "Worked on it must not discard the edit");
  assert.equal(task.due, "2026-09-03");
  assert.equal(ctx.state.considered[t.id], "worked");
});

test("worked-task: the edit and the mark are ONE undo step", async () => {
  const { ctx, shim } = await loadApp({ seed: 235 });
  const t = ctx.addTask("Old title", true);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "New title" });
  ctx.onAction("worked-task", { dataset: { id: t.id } });
  assert.equal(ctx.state.considered[t.id], "worked", "precondition: it was marked");

  ctx.undo();
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "Old title", "one undo reverses the edit...");
  assert.equal(t.id in ctx.state.considered, false, "...and the mark that rode along with it");
  assert.deepEqual([...ctx.state.chain], [t.id], "...and restores the dot");
});

test("worked-task: clears the candidate slot and any can't timestamp", async () => {
  const { ctx } = await loadApp({ seed: 236 });
  const t = ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.state.candidateId = t.id;
  ctx.state.cantAt[t.id] = realNow(ctx);

  ctx.openEdit(t.id);
  ctx.onAction("worked-task", { dataset: { id: t.id } });
  assert.notEqual(ctx.state.candidateId, t.id, "the worked task must not stay on offer");
  assert.equal(t.id in ctx.state.cantAt, false, "no orphaned can't timestamp should linger");
});

test("workedOnTask: an unknown, null, or undefined id is a safe no-op", async () => {
  const { ctx } = await loadApp({ seed: 237 });
  ctx.addTask("Task A", false);
  ctx.workedOnTask("no-such-id");
  ctx.workedOnTask(null);
  ctx.workedOnTask(undefined);
  assert.equal(ctx.state.tasks.filter((x) => !x.done).length, 1);
  assert.deepEqual(Object.keys(ctx.state.considered), []);
});

/* ---------- Dot: onto the chain straight from the edit pane ----------
   The scan's own way onto the chain is answering "yes" to a comparison, which
   moves rank. This is the override for when you already know — so it dots the
   task WITHOUT inventing a rank signal, the same stance doneTask(),
   workedOnTask() and dislodge() take about gestures that answered no
   "would I rather?". It lands on the end of the chain, i.e. it becomes the
   benchmark: the thing you do next. */

test("dotTask: pushes onto the end of the chain, making it the new benchmark", async () => {
  const { ctx } = await loadApp({ seed: 368 });
  const buried = ctx.addTask("Already dotted", true);
  const t = ctx.addTask("Dot me", false);

  ctx.dotTask(t.id);
  assert.deepEqual([...ctx.state.chain], [buried.id, t.id], "it goes on top, not underneath");
  assert.equal(ctx.benchmark().id, t.id, "the newest dot is what you do next");
});

test("dotTask: dotting an empty chain roots the chain", async () => {
  const { ctx } = await loadApp({ seed: 369 });
  const t = ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  assert.equal(ctx.state.chain.length, 0, "precondition: nothing dotted");

  ctx.dotTask(t.id);
  assert.deepEqual([...ctx.state.chain], [t.id]);
  assert.equal(ctx.benchmark().id, t.id);
});

test("dotTask: rooting a chain starts the stale-pass clock, like startScan()", async () => {
  const { ctx } = await loadApp({ seed: 370 });
  const t = ctx.addTask("Task A", false);
  assert.equal(ctx.state.passStartedAt, 0, "precondition: no pass is running");

  const before = realNow(ctx);
  ctx.dotTask(t.id);
  assert.ok(ctx.state.passStartedAt >= before,
    `a fresh chain root is a fresh pass — passStartedAt should be stamped, got ${ctx.state.passStartedAt}`);
});

test("dotTask: dotting onto a running chain does NOT re-stamp the pass clock", async () => {
  const { ctx } = await loadApp({ seed: 371 });
  ctx.addTask("Root", false);
  const t = ctx.addTask("Later dot", false);
  // A fixed local 10:00, so advancing an hour can never cross the 02:00 day
  // line and trip the auto-recycle, whatever time of day the suite runs at.
  const t0 = new Date(2027, 0, 15, 10, 0, 0).getTime();
  setFakeTime(ctx, t0);
  ctx.startScan();                       // roots the chain, stamping the clock at t0
  assert.equal(ctx.state.passStartedAt, t0, "precondition: the root started the pass");

  setFakeTime(ctx, t0 + 60 * 60000);     // 11:00 the same morning — same pass, nowhere near stale
  ctx.dotTask(t.id);
  assert.equal(ctx.state.passStartedAt, t0,
    "a pass that keeps getting re-stamped never goes stale — only a fresh root starts the clock");
});

test("dotTask: records no rank signal — nothing was compared", async () => {
  const { ctx } = await loadApp({ seed: 372 });
  const bench = ctx.addTask("Benchmark", true);
  const t = ctx.addTask("Dot me", false);
  const before = ctx.state.tasks.map((x) => ({ id: x.id, mu: x.mu, sigma: x.sigma }));

  ctx.dotTask(t.id);
  for (const b of before) {
    const now = ctx.state.tasks.find((x) => x.id === b.id);
    assert.equal(now.mu, b.mu, `mu moved on ${now.title} — dotting answered no "would I rather?"`);
    assert.equal(now.sigma, b.sigma, `sigma moved on ${now.title}`);
  }
  assert.equal(ctx.benchmark().id, t.id, "precondition check: it really did get dotted");
  assert.ok(bench.id !== t.id);
});

test("dotTask: clears a no / can't / dislodged / worked mark — a dotted task is not skipped", async () => {
  for (const [i, mark] of ["no", "cant", "dislodged", "worked"].entries()) {
    const { ctx } = await loadApp({ seed: 373 + i * 1000 });
    ctx.addTask("Root", true);
    const t = ctx.addTask("Skipped task", false);
    ctx.state.considered[t.id] = mark;

    ctx.dotTask(t.id);
    assert.equal(t.id in ctx.state.considered, false,
      `a "${mark}" mark must not survive the task being dotted`);
    assert.ok(ctx.state.chain.includes(t.id));
  }
});

test("dotTask: clears the can't / worked timestamps alongside the mark", async () => {
  const { ctx } = await loadApp({ seed: 374 });
  ctx.addTask("Root", true);
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "cant";
  ctx.state.cantAt[t.id] = realNow(ctx);
  ctx.state.workedAt[t.id] = realNow(ctx);

  ctx.dotTask(t.id);
  assert.equal(t.id in ctx.state.cantAt, false, "no orphaned can't timestamp should linger");
  assert.equal(t.id in ctx.state.workedAt, false, "no orphaned worked timestamp should linger");
});

test("dotTask: clears the candidate slot when the dotted task was the one on offer", async () => {
  const { ctx } = await loadApp({ seed: 375 });
  ctx.addTask("Root", true);
  const t = ctx.addTask("Task A", false);
  ctx.state.candidateId = t.id;

  ctx.dotTask(t.id);
  assert.notEqual(ctx.state.candidateId, t.id,
    "a task already on the chain must not still be on offer — answering yes would dot it twice");
});

test("dotTask: leaves the candidate slot alone when some other task is on offer", async () => {
  const { ctx } = await loadApp({ seed: 376 });
  ctx.addTask("Root", true);
  const onOffer = ctx.addTask("On offer", false);
  const t = ctx.addTask("Dot me", false);
  ctx.state.candidateId = onOffer.id;

  ctx.dotTask(t.id);
  assert.equal(ctx.state.candidateId, onOffer.id, "an unrelated candidate should survive");
});

test("dotTask: clears an active intervention", async () => {
  const { ctx } = await loadApp({ seed: 377 });
  ctx.addTask("Root", true);
  const t = ctx.addTask("Task A", false);
  ctx.state.interventionActive = true;

  ctx.dotTask(t.id);
  assert.equal(ctx.state.interventionActive, false, "dotting is a decision — it dismisses the stop-scanning prompt");
});

test("dotTask: leaves the mode alone — dotting while working does not resume scanning", async () => {
  const { ctx } = await loadApp({ seed: 378 });
  ctx.addTask("Root", true);
  const t = ctx.addTask("Task A", false);
  ctx.state.mode = "work";

  ctx.dotTask(t.id);
  assert.equal(ctx.state.mode, "work", "queueing something up next says nothing about resuming the scan");
  assert.ok(ctx.state.chain.includes(t.id));
});

test("dotTask: a task already on the chain is a no-op, never a second dot", async () => {
  const { ctx } = await loadApp({ seed: 379 });
  const root = ctx.addTask("Root", true);
  const t = ctx.addTask("Task A", true);
  assert.deepEqual([...ctx.state.chain], [root.id, t.id], "precondition");

  ctx.dotTask(root.id);
  assert.deepEqual([...ctx.state.chain], [root.id, t.id],
    "a duplicate id on the chain would break benchmark() and the crumb trail");
});

test("dotTask: a completed task is a no-op — a done task must never be dotted", async () => {
  const { ctx } = await loadApp({ seed: 380 });
  const t = ctx.addTask("Task A", false);
  ctx.doneTask(t.id);
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).done, true, "precondition");

  ctx.dotTask(t.id);
  assert.equal(ctx.state.chain.includes(t.id), false);
});

test("dotTask: an unknown, null, or undefined id is a safe no-op", async () => {
  const { ctx } = await loadApp({ seed: 381 });
  ctx.addTask("Task A", false);
  ctx.dotTask("no-such-id");
  ctx.dotTask(null);
  ctx.dotTask(undefined);
  assert.equal(ctx.state.chain.length, 0);
  assert.equal(ctx.state.tasks.length, 1);
});

test("dotTask: dots an ineligible task anyway — a future start date does not block a deliberate dot", async () => {
  const { ctx } = await loadApp({ seed: 387 });
  const t = ctx.addTask("Starts next month", false);
  ctx.state.tasks.find((x) => x.id === t.id).startsAt = "2099-01-01";

  ctx.dotTask(t.id);
  assert.deepEqual([...ctx.state.chain], [t.id], "you opened it and clicked Dot — that is the decision");
});

test("dotTask: dots a task whose context is switched off anyway", async () => {
  const { ctx } = await loadApp({ seed: 388 });
  ctx.state.contexts.push({ id: "ctx-office", name: "Office", active: false });
  const t = ctx.addTask("Office job", false, ["ctx-office"]);
  assert.equal(ctx.isEligible(t), false, "precondition: filtered out of the scan right now");

  ctx.dotTask(t.id);
  assert.deepEqual([...ctx.state.chain], [t.id]);
});

/* ---------- the edit pane's Dot button ---------- */

test("UI: the edit pane renders a Dot button carrying that task's id", async () => {
  const { ctx, shim } = await loadApp({ seed: 384 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, /data-act="dot-task"/, `expected a dot-task button in: ${html}`);
  assert.match(html, new RegExp(`data-act="dot-task" data-id="${t.id}"`));
});

test("UI: no Dot button on a task that is already dotted", async () => {
  const { ctx, shim } = await loadApp({ seed: 385 });
  const dotted = ctx.addTask("Already dotted", true);
  const loose = ctx.addTask("Not dotted", false);

  // Both halves on purpose: asserting only the absence would pass just as well
  // against a build that renders no Dot button at all, anywhere.
  ctx.openEdit(loose.id);
  assert.match(shim.elements.get("modalRoot").innerHTML, /data-act="dot-task"/,
    "control: an undotted task must offer the button");

  ctx.openEdit(dotted.id);
  assert.doesNotMatch(shim.elements.get("modalRoot").innerHTML, /data-act="dot-task"/,
    "nothing to offer — it is already on the chain");
});

test("CSS: the Dot button paints a background, so it isn't white-on-nothing", () => {
  // .btn sets color:#fff and no background of its own — every variant supplies
  // one. A .btn.dot with no rule wouldn't look plain, it would be invisible.
  const rule = styleSrc.match(/\.btn\.dot\{([^}]*)\}/);
  assert.ok(rule, "there should be a .btn.dot rule");
  assert.match(rule[1], /background:var\(--chain-deep\)/,
    `the button that puts a task on the chain should wear the chain's own colour: ${rule[1]}`);
});

test("dot-task: saves the fields you just edited, dots it, and closes the pane", async () => {
  const { ctx, shim } = await loadApp({ seed: 386 });
  ctx.addTask("Root", true);
  const t = ctx.addTask("Old title", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Renamed on the way out", due: "2026-09-03" });

  ctx.onAction("dot-task", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "Renamed on the way out", "Dot must not discard the edit");
  assert.equal(task.due, "2026-09-03");
  assert.ok(ctx.state.chain.includes(t.id), "and it should be dotted");
  assert.equal(shim.elements.get("modalRoot").innerHTML, "", "the modal should close behind it");
});

test("dot-task: the edit and the dot are ONE undo step", async () => {
  const { ctx, shim } = await loadApp({ seed: 382 });
  ctx.addTask("Root", true);
  const t = ctx.addTask("Old title", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "New title" });
  ctx.onAction("dot-task", { dataset: { id: t.id } });
  assert.ok(ctx.state.chain.includes(t.id), "precondition: it was dotted");

  ctx.undo();
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "Old title", "one undo reverses the edit...");
  assert.equal(ctx.state.chain.includes(t.id), false, "...and the dot that rode along with it");
});

test("dot-task: syncs to the cloud right away, like every other dot", async () => {
  // makeSyncHarness, not makeFakeCloudSyncFactory: the latter answers a bare
  // null for an empty cloud, which cloudPull() reads as "the read failed" and
  // refuses to authorise any write off — so nothing would ever push through it.
  const h = makeSyncHarness();
  const { ctx, shim } = await loadApp({ seed: 383, cloudSyncFactory: h.factory });
  const pushes = () => h.calls.filter((c) => c === "push").length;

  ctx.addTask("Root", true);
  const t = ctx.addTask("Task A", false);
  await new Promise((r) => setTimeout(r, 300));
  h.calls.length = 0;                      // ignore whatever the setup already flushed

  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Task A" });
  ctx.onAction("save-edit", { dataset: { id: t.id } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(pushes(), 0, "a plain Save is debounced, not immediate — the contrast the next half rests on");

  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Task A" });
  ctx.onAction("dot-task", { dataset: { id: t.id } });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(pushes() > 0, "a dot must not wait out the 2s debounce — the other device needs it now");
});

/* ---------- edit pane decluttering ---------- */

test("UI: the Starts hint reads in parentheses", async () => {
  const { ctx, shim } = await loadApp({ seed: 238 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  assert.match(shim.elements.get("modalRoot").innerHTML, /\(not eligible for the queue until this date\)/);
});

test("UI: the edit pane leads with the task actions, then the form actions", async () => {
  const { ctx, shim } = await loadApp({ seed: 239 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;

  const rows = html.match(/<div class="mbtns[^"]*">[\s\S]*?<\/div>/g) || [];
  assert.equal(rows.length, 2, `expected two button rows, got ${rows.length} in: ${html}`);

  // Row 1 — what to do with the TASK. (Return as candidate only ever shows up
  // once a mark makes it relevant — see the "return as candidate" section
  // below — so a plain, unmarked task doesn't render it at all.)
  assert.match(rows[0], /data-act="done-task"/, "Done leads");
  assert.match(rows[0], /data-act="worked-task"/, "then Worked on it");
  assert.ok(!/data-act="return-candidate"/.test(rows[0]), "no skip mark on this task, so nothing to return");
  assert.ok(!/data-act="save-edit"/.test(rows[0]), "Save belongs to the row below");
  assert.ok(!/data-act="delete-task"/.test(rows[0]), "and so does Delete");

  // Row 2 — what to do with the FORM, with Delete held apart on the right.
  assert.match(rows[1], /data-act="save-edit"/);
  assert.match(rows[1], /data-act="close-modal"/);
  assert.match(rows[1], /data-act="delete-task"/);
  assert.ok(rows[1].indexOf('data-act="save-edit"') < rows[1].indexOf('data-act="delete-task"'),
    "Delete should come after Save/Cancel, pushed to the far side");
});

// Characterization test — Cancel's throw-it-away behavior is unchanged.
test("close-modal: Cancel still throws unsaved edits away", async () => {
  const { ctx, shim } = await loadApp({ seed: 218 });
  const t = ctx.addTask("Old title", false);
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Typed but never saved" });

  ctx.onAction("close-modal", { dataset: {} });
  assert.equal(ctx.state.tasks.find((x) => x.id === t.id).title, "Old title");
  assert.equal(shim.elements.get("modalRoot").innerHTML, "");
});

/* ---------- return as candidate ----------
   A card can be excluded from the pool by a mark left behind from scanning
   (no/can't/dislodged/worked) or by a genuine completion (done, evergreen
   only). This button undoes the former, per task, from the edit pane — it
   deliberately leaves 'done' alone, the same line rescanSkipped() draws. */

test("UI: the edit pane renders a 'Return as candidate' button carrying that task's id, when it applies", async () => {
  const { ctx, shim } = await loadApp({ seed: 320 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "cant";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, new RegExp(`data-act="return-candidate" data-id="${t.id}"`), `expected in: ${html}`);
  assert.match(html, /Return as candidate/);
});

test("UI: 'Return as candidate' does not appear at all when the task has no skip mark", async () => {
  const { ctx, shim } = await loadApp({ seed: 321 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.ok(!html.includes('data-act="return-candidate"'), `expected no Return as candidate button in: ${html}`);
});

test("UI: 'Return as candidate' does not appear when the task is marked 'done' (evergreen rest, not a skip)", async () => {
  const { ctx, shim } = await loadApp({ seed: 322 });
  const t = ctx.addTask("Water the plants", false);
  ctx.state.considered[t.id] = "done";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.ok(!html.includes('data-act="return-candidate"'), `expected no Return as candidate button in: ${html}`);
});

test("UI: 'Return as candidate' appears when the task is marked 'cant'", async () => {
  const { ctx, shim } = await loadApp({ seed: 323 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "cant";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, new RegExp(`data-act="return-candidate" data-id="${t.id}"`), `expected in: ${html}`);
});

test("UI: 'Return as candidate' appears when the task is marked 'no'", async () => {
  const { ctx, shim } = await loadApp({ seed: 324 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "no";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, new RegExp(`data-act="return-candidate" data-id="${t.id}"`), `expected in: ${html}`);
});

test("UI: 'Return as candidate' appears when the task is marked 'dislodged'", async () => {
  const { ctx, shim } = await loadApp({ seed: 325 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "dislodged";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, new RegExp(`data-act="return-candidate" data-id="${t.id}"`), `expected in: ${html}`);
});

test("UI: 'Return as candidate' appears when the task is marked 'worked'", async () => {
  const { ctx, shim } = await loadApp({ seed: 326 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "worked";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, new RegExp(`data-act="return-candidate" data-id="${t.id}"`), `expected in: ${html}`);
});

test("UI: when it appears, 'Return as candidate' sits in the task-actions row, not the form row", async () => {
  const { ctx, shim } = await loadApp({ seed: 340 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "cant";
  ctx.openEdit(t.id);
  const html = shim.elements.get("modalRoot").innerHTML;

  const rows = html.match(/<div class="mbtns[^"]*">[\s\S]*?<\/div>/g) || [];
  assert.equal(rows.length, 2, `expected two button rows, got ${rows.length} in: ${html}`);
  assert.match(rows[0], /data-act="return-candidate"/, "alongside Done and Worked on it");
  assert.ok(!/data-act="return-candidate"/.test(rows[1]), "not down with Save/Cancel/Delete");
});

test("returnAsCandidate: clears a 'cant' mark and its cantAt timestamp", async () => {
  const { ctx } = await loadApp({ seed: 327 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "cant";
  ctx.state.cantAt[t.id] = realNow(ctx);
  ctx.returnAsCandidate(t.id);
  assert.equal(t.id in ctx.state.considered, false);
  assert.equal(t.id in ctx.state.cantAt, false);
});

test("returnAsCandidate: clears a 'worked' mark", async () => {
  const { ctx } = await loadApp({ seed: 328 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "worked";
  ctx.returnAsCandidate(t.id);
  assert.equal(t.id in ctx.state.considered, false);
});

test("returnAsCandidate: clears a 'no' mark", async () => {
  const { ctx } = await loadApp({ seed: 329 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "no";
  ctx.returnAsCandidate(t.id);
  assert.equal(t.id in ctx.state.considered, false);
});

test("returnAsCandidate: clears a 'dislodged' mark", async () => {
  const { ctx } = await loadApp({ seed: 330 });
  const t = ctx.addTask("Task A", false);
  ctx.state.considered[t.id] = "dislodged";
  ctx.returnAsCandidate(t.id);
  assert.equal(t.id in ctx.state.considered, false);
});

test("returnAsCandidate: a no-op when the task has no skip mark (nothing to return)", async () => {
  const { ctx } = await loadApp({ seed: 331 });
  const t = ctx.addTask("Task A", false);
  const before = readConst(ctx, "undoStack.length");   // addTask() itself pushes one — measure the delta, not an absolute count
  ctx.returnAsCandidate(t.id);
  assert.equal(t.id in ctx.state.considered, false);
  assert.equal(readConst(ctx, "undoStack.length"), before, "no undo snapshot should be pushed for a no-op");
});

test("returnAsCandidate: a no-op when the task is marked 'done'", async () => {
  const { ctx } = await loadApp({ seed: 332 });
  const t = ctx.addTask("Water the plants", false);
  ctx.state.considered[t.id] = "done";
  const before = readConst(ctx, "undoStack.length");
  ctx.returnAsCandidate(t.id);
  assert.equal(ctx.state.considered[t.id], "done", "the 'done' mark must be left alone");
  assert.equal(readConst(ctx, "undoStack.length"), before, "no undo snapshot should be pushed for a no-op");
});

test("returnAsCandidate: an unknown, null, or undefined id is a safe no-op", async () => {
  const { ctx } = await loadApp({ seed: 333 });
  ctx.addTask("Task A", false);
  ctx.returnAsCandidate("no-such-id");
  ctx.returnAsCandidate(null);
  ctx.returnAsCandidate(undefined);
  assert.equal(ctx.state.tasks.filter((x) => !x.done).length, 1);
  assert.deepEqual(Object.keys(ctx.state.considered), []);
});

test("return-candidate: saves the fields you just edited before clearing the mark, and closes the pane", async () => {
  const { ctx, shim } = await loadApp({ seed: 334 });
  const t = ctx.addTask("Old title", false);
  ctx.state.considered[t.id] = "cant";
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "Renamed on the way out" });

  ctx.onAction("return-candidate", { dataset: { id: t.id } });
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "Renamed on the way out", "must not discard the edit");
  assert.equal(t.id in ctx.state.considered, false);
  assert.equal(shim.elements.get("modalRoot").innerHTML, "", "the modal should close behind it");
});

test("return-candidate: the edit and the clear are ONE undo step", async () => {
  const { ctx, shim } = await loadApp({ seed: 335 });
  const t = ctx.addTask("Old title", false);
  ctx.state.considered[t.id] = "worked";
  ctx.openEdit(t.id);
  fillEditPane(ctx, shim, { title: "New title" });
  ctx.onAction("return-candidate", { dataset: { id: t.id } });
  assert.equal(t.id in ctx.state.considered, false, "precondition: it was cleared");

  ctx.undo();
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.title, "Old title", "one undo reverses the edit...");
  assert.equal(ctx.state.considered[t.id], "worked", "...and restores the mark that rode along with it");
});

test("return-candidate: via onAction, a task with no skip mark is untouched and the pane stays open", async () => {
  const { ctx, shim } = await loadApp({ seed: 336 });
  const t = ctx.addTask("Task A", false);
  ctx.openEdit(t.id);

  ctx.onAction("return-candidate", { dataset: { id: t.id } });
  assert.notEqual(shim.elements.get("modalRoot").innerHTML, "", "the pane should stay open — nothing to return");
  assert.equal(t.id in ctx.state.considered, false);
});

/* ---------- work log: History also remembers worked-on and evergreen-done ----------
   These tasks stay open and cycle back through the scan — they never set
   t.done — so without a separate record, "worked on it" and completing an
   evergreen task leave no trace once their skip mark clears. state.workLog is
   an append-only record of those events, decoupled from state.considered, so
   it survives Return as candidate, Rescan skipped tasks, and New pass. Not
   restorable: the task behind an entry is still active, so there's nothing
   to restore it *to*. */

test("app harness: a fresh state starts with an empty work log", async () => {
  const { ctx } = await loadApp();
  assert.deepEqual([...ctx.state.workLog], []);
});

test("completeTask: an evergreen task logs an 'evergreen-done' entry instead of setting done", async () => {
  const { ctx } = await loadApp({ seed: 350 });
  const t = ctx.addTask("Water the plants", false);
  ctx.state.tasks.find((x) => x.id === t.id).evergreen = true;
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));

  const task = ctx.state.tasks.find((x) => x.id === t.id);
  assert.equal(task.done, false, "evergreen tasks never flip 'done'");
  assert.equal(ctx.state.workLog.length, 1);
  const entry = ctx.state.workLog[0];
  assert.equal(entry.taskId, t.id);
  assert.equal(entry.title, "Water the plants");
  assert.equal(entry.kind, "evergreen-done");
  assert.equal(entry.at, task.lastDoneAt);
});

test("completeTask: a regular (non-evergreen) task does not add a work log entry", async () => {
  const { ctx } = await loadApp({ seed: 351 });
  const t = ctx.addTask("Task A", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  assert.deepEqual([...ctx.state.workLog], []);
});

test("workedOnTask: logs a 'worked' entry", async () => {
  const { ctx } = await loadApp({ seed: 352 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  assert.equal(ctx.state.workLog.length, 1);
  const entry = ctx.state.workLog[0];
  assert.equal(entry.taskId, t.id);
  assert.equal(entry.title, "Task A");
  assert.equal(entry.kind, "worked");
  assert.ok(entry.at > 0);
});

test("workedOnTask: two sessions on the same task the same day are one History row", async () => {
  const { ctx } = await loadApp({ seed: 353 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  ctx.workedOnTask(t.id);
  assert.equal(ctx.state.workLog.length, 1, "one day's work on one task is one row");
});

test("workedOnTask: sessions on different days are two History rows", async () => {
  const { ctx } = await loadApp({ seed: 3531 });
  const t = ctx.addTask("Task A", false);
  setFakeTime(ctx, localAt(30, 11, 0));
  ctx.workedOnTask(t.id);
  setFakeTime(ctx, localAt(31, 11, 0));
  ctx.workedOnTask(t.id);
  assert.equal(ctx.state.workLog.length, 2, "Sunday and Monday is two days of work, not a duplicate");
});

test("completeTask: completing the same evergreen task twice logs two separate entries", async () => {
  const { ctx } = await loadApp({ seed: 354 });
  const t = ctx.addTask("Water the plants", false);
  ctx.state.tasks.find((x) => x.id === t.id).evergreen = true;
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  assert.equal(ctx.state.workLog.length, 2);
});

test("returnAsCandidate: clearing a 'worked' mark does not remove its work log entry", async () => {
  const { ctx } = await loadApp({ seed: 355 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  ctx.returnAsCandidate(t.id);
  assert.equal(t.id in ctx.state.considered, false, "precondition: the mark is cleared");
  assert.equal(ctx.state.workLog.length, 1, "the log entry survives the mark being cleared");
});

test("rescanSkipped: clearing skip marks in bulk does not touch the work log", async () => {
  const { ctx } = await loadApp({ seed: 356 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  ctx.rescanSkipped();
  assert.equal(ctx.state.workLog.length, 1);
});

test("newPass: starting a fresh pass does not touch the work log", async () => {
  const { ctx } = await loadApp({ seed: 357 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  ctx.newPass();
  assert.equal(ctx.state.workLog.length, 1);
});

test("undo: reverses a 'worked' marking, log entry and all", async () => {
  const { ctx } = await loadApp({ seed: 358 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  assert.equal(ctx.state.workLog.length, 1, "precondition");
  ctx.undo();
  assert.deepEqual(ctx.state.workLog, []);
});

test("deleteTask: does not remove that task's existing work log entries", async () => {
  const { ctx } = await loadApp({ seed: 359 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  ctx.deleteTask(t.id);
  assert.equal(ctx.state.workLog.length, 1, "the log is a historical record, independent of the task's lifecycle");
});

test("historyRows: combines done tasks and work-log entries, newest first", async () => {
  const { ctx } = await loadApp({ seed: 360 });
  setFakeTime(ctx, 1000);
  const a = ctx.addTask("Old completion", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === a.id));

  setFakeTime(ctx, 2000);
  const b = ctx.addTask("Recent worked-on", false);
  ctx.workedOnTask(b.id);

  const rows = ctx.historyRows();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Recent worked-on", "the later event sorts first");
  assert.equal(rows[1].title, "Old completion");
});

test("renderHistory: a 'worked' entry shows its title and a 'worked on it' label, with no restore button", async () => {
  const { ctx, shim } = await loadApp({ seed: 361 });
  ctx.state.histOpen = true;
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);

  const html = shim.elements.get("histPanel").innerHTML;
  assert.match(html, /Task A/);
  assert.match(html, /worked on it/i);
  assert.ok(!new RegExp(`data-act="restore" data-id="${t.id}"`).test(html), "a worked-on entry must not be restorable");
});

test("renderHistory: an 'evergreen-done' entry shows its title and an evergreen label, with no restore button", async () => {
  const { ctx, shim } = await loadApp({ seed: 362 });
  ctx.state.histOpen = true;
  const t = ctx.addTask("Water the plants", false);
  ctx.state.tasks.find((x) => x.id === t.id).evergreen = true;
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  ctx.commit();

  const html = shim.elements.get("histPanel").innerHTML;
  assert.match(html, /Water the plants/);
  assert.match(html, /evergreen/i);
  assert.ok(!new RegExp(`data-act="restore" data-id="${t.id}"`).test(html), "an evergreen completion must not be restorable");
});

test("renderHistory: a regular completed task still shows a restore button", async () => {
  const { ctx, shim } = await loadApp({ seed: 363 });
  ctx.state.histOpen = true;
  const t = ctx.addTask("Task A", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  ctx.commit();

  const html = shim.elements.get("histPanel").innerHTML;
  assert.match(html, new RegExp(`data-act="restore" data-id="${t.id}"`));
});

test("renderHistory: the header count includes work-log entries alongside done tasks", async () => {
  const { ctx, shim } = await loadApp({ seed: 364 });
  const a = ctx.addTask("Task A", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === a.id));
  const b = ctx.addTask("Task B", false);
  ctx.workedOnTask(b.id);
  ctx.commit();

  const html = shim.elements.get("histPanel").innerHTML;
  assert.match(html, /\(2 entries\)/);
});

test("clearCompleted: clears the work log along with completed tasks", async () => {
  const { ctx } = await loadApp({ seed: 365 });
  const a = ctx.addTask("Task A", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === a.id));
  const b = ctx.addTask("Task B", false);
  ctx.workedOnTask(b.id);

  ctx.clearCompleted();
  assert.equal(ctx.state.tasks.some((x) => x.done), false);
  assert.deepEqual([...ctx.state.workLog], []);
});

test("clearCompleted: still runs (and clears the log) when there are no done tasks, only logged ones", async () => {
  const { ctx } = await loadApp({ seed: 366 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);
  assert.equal(ctx.state.tasks.some((x) => x.done), false, "precondition: nothing is actually done");

  ctx.clearCompleted();
  assert.deepEqual([...ctx.state.workLog], [], "should have cleared even with zero done tasks");
});

test("openSettings: shows the housekeeping copy and Clear history button when only work-log entries exist", async () => {
  const { ctx, shim } = await loadApp({ seed: 367 });
  const t = ctx.addTask("Task A", false);
  ctx.workedOnTask(t.id);

  ctx.openSettings();
  const html = shim.elements.get("modalRoot").innerHTML;
  assert.match(html, /data-act="clear-done"/, "Clear history should be offered");
  assert.ok(!/No completed tasks stored right now/.test(html));
});

/* =====================================================================
   NIGHT MODE — Unit 1: preference model & resolution
   ===================================================================== */
const STORE_KEY = "fvp:chain-scanner:v1";

test("theme: a fresh state defaults the preference to 'system'", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.state.settings.theme, "system");
});

test("theme: state saved before night mode existed migrates to 'system' on boot", async () => {
  const legacy = {
    v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, candidateId: null,
    interventionActive: false, interventionP: 0, snooze: 0, mode: "scan", decisionsMs: [],
    presentedAt: 0, listOpen: false, ctxOpen: true, histOpen: false, updatedAt: 0,
    settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30 }, // no theme key
  };
  const { ctx } = await loadApp({ seedStorage: { [STORE_KEY]: JSON.stringify(legacy) } });
  assert.equal(ctx.state.settings.theme, "system");
});

test("theme: a corrupt stored preference is repaired to 'system' on boot", async () => {
  const bad = {
    v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, candidateId: null,
    interventionActive: false, interventionP: 0, snooze: 0, mode: "scan", decisionsMs: [],
    presentedAt: 0, listOpen: false, ctxOpen: true, histOpen: false, updatedAt: 0,
    settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, theme: "banana" },
  };
  const { ctx } = await loadApp({ seedStorage: { [STORE_KEY]: JSON.stringify(bad) } });
  assert.equal(ctx.state.settings.theme, "system");
});

test("setTheme: accepts each of the three valid preferences", async () => {
  const { ctx } = await loadApp();
  ctx.setTheme("dark");
  assert.equal(ctx.state.settings.theme, "dark");
  ctx.setTheme("light");
  assert.equal(ctx.state.settings.theme, "light");
  ctx.setTheme("system");
  assert.equal(ctx.state.settings.theme, "system");
});

test("setTheme: an unrecognised value falls back to 'system' rather than sticking", async () => {
  const { ctx } = await loadApp();
  ctx.setTheme("dark");
  ctx.setTheme("banana");
  assert.equal(ctx.state.settings.theme, "system");
});

test("resolvedTheme: with preference 'system', follows the OS reporting dark", async () => {
  const { ctx } = await loadApp({ prefersDark: true });
  assert.equal(ctx.state.settings.theme, "system");
  assert.equal(ctx.resolvedTheme(), "dark");
});

test("resolvedTheme: with preference 'system', follows the OS reporting light", async () => {
  const { ctx } = await loadApp({ prefersDark: false });
  assert.equal(ctx.resolvedTheme(), "light");
});

test("resolvedTheme: an explicit preference overrides the OS in both directions", async () => {
  const { ctx: darkOS } = await loadApp({ prefersDark: true });
  darkOS.setTheme("light");
  assert.equal(darkOS.resolvedTheme(), "light", "explicit light must win over a dark OS");

  const { ctx: lightOS } = await loadApp({ prefersDark: false });
  lightOS.setTheme("dark");
  assert.equal(lightOS.resolvedTheme(), "dark", "explicit dark must win over a light OS");
});

test("resolvedTheme: an environment with no matchMedia resolves light instead of throwing", async () => {
  const { ctx } = await loadApp({ noMatchMedia: true });
  assert.equal(ctx.resolvedTheme(), "light");
});

/* =====================================================================
   NIGHT MODE — Unit 2: DOM application, persistence, anti-flash boot
   ===================================================================== */
const THEME_HINT_KEY = "fvp:chain-scanner:theme";

// The synchronous <head> script that paints before first frame, sliced out of
// index.html the same way the engine is, so it's tested as shipped. Sliced
// lazily: at module load a missing marker would take down the whole file.
const themeBootSrc = () => slice(html, "/*THEME-BOOT-START*/", "/*THEME-BOOT-END*/");

function runThemeBoot({ hint, throwingStorage = false } = {}) {
  const root = makeFakeElement();
  const store = new Map();
  if (hint !== undefined) store.set(THEME_HINT_KEY, hint);
  const sandbox = {
    document: { documentElement: root },
    localStorage: throwingStorage
      ? { getItem() { throw new Error("storage blocked"); } }
      : { getItem(k) { return store.has(k) ? store.get(k) : null; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(themeBootSrc(), sandbox, { filename: "index.html#theme-boot" });
  return root;
}

test("applyTheme: an explicit dark preference puts data-theme=dark on the root element", async () => {
  const { ctx, shim } = await loadApp();
  ctx.setTheme("dark");
  assert.equal(shim.documentElement.getAttribute("data-theme"), "dark");
});

test("applyTheme: an explicit light preference puts data-theme=light on the root element", async () => {
  const { ctx, shim } = await loadApp({ prefersDark: true });
  ctx.setTheme("light");
  assert.equal(shim.documentElement.getAttribute("data-theme"), "light");
});

test("applyTheme: the 'system' preference removes data-theme so CSS follows the OS unaided", async () => {
  const { ctx, shim } = await loadApp();
  ctx.setTheme("dark");
  assert.equal(shim.documentElement.getAttribute("data-theme"), "dark");
  ctx.setTheme("system");
  assert.equal(shim.documentElement.getAttribute("data-theme"), null,
    "no attribute means color-scheme: light dark governs, which is what makes it reactive");
});

test("setTheme: marks the state dirty so the choice syncs to other devices", async () => {
  const { ctx } = await loadApp();
  const before = ctx.state.updatedAt;
  ctx.setTheme("dark");
  assert.ok(ctx.state.updatedAt > before, "updatedAt must advance or the sync will not push");
});

test("setTheme: writes the paint hint for explicit preferences", async () => {
  const { ctx, shim } = await loadApp();
  ctx.setTheme("dark");
  assert.equal(shim.localStorage.getItem(THEME_HINT_KEY), "dark");
  ctx.setTheme("light");
  assert.equal(shim.localStorage.getItem(THEME_HINT_KEY), "light");
});

test("setTheme: clears the paint hint for 'system' so a stale hint cannot outvote the OS", async () => {
  const { ctx, shim } = await loadApp();
  ctx.setTheme("dark");
  ctx.setTheme("system");
  assert.equal(shim.localStorage.getItem(THEME_HINT_KEY), null);
});

test("boot: a synced dark preference is applied to the root element on load", async () => {
  const stored = {
    v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, candidateId: null,
    interventionActive: false, interventionP: 0, snooze: 0, mode: "scan", decisionsMs: [],
    presentedAt: 0, listOpen: false, ctxOpen: true, histOpen: false, updatedAt: 0,
    settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, theme: "dark" },
  };
  const { shim } = await loadApp({ seedStorage: { [STORE_KEY]: JSON.stringify(stored) } });
  assert.equal(shim.documentElement.getAttribute("data-theme"), "dark");
});

test("applyTheme: a host with no documentElement is a safe no-op", async () => {
  const shim = makeDomShim();
  delete shim.document.documentElement;
  const sandbox = {
    window: shim.window, document: shim.document, localStorage: shim.localStorage,
    console, JSON,
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); } },
    setTimeout: (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); t.unref?.(); return t; },
    clearTimeout, requestAnimationFrame: (fn) => setTimeout(fn, 0),
    confirm: () => true, alert: () => {}, prompt: () => null,
  };
  vm.createContext(sandbox);
  vm.runInContext(appSrc, sandbox, { filename: "index.html#app" });
  await flush();
  assert.doesNotThrow(() => sandbox.setTheme("dark"));
});

test("cloudPull: adopting a remote state applies that device's theme locally", async () => {
  const remoteState = {
    v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, candidateId: null,
    interventionActive: false, interventionP: 0, snooze: 0, mode: "scan", decisionsMs: [],
    presentedAt: 0, listOpen: false, ctxOpen: true, histOpen: false, updatedAt: Date.now() + 100000,
    settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, theme: "dark" },
  };
  const { ctx, shim } = await loadApp({
    cloudSyncFactory: () => ({
      configured: true, ready: true, user: "e@example.com", status: "on",
      signIn() {}, signOut() {},
      async pull() { return { updatedAt: remoteState.updatedAt, payload: JSON.stringify(remoteState) }; },
      async push() {},
    }),
  });
  assert.equal(shim.documentElement.getAttribute("data-theme"), null, "starts on system");
  await ctx.cloudPull();
  assert.equal(ctx.state.settings.theme, "dark");
  assert.equal(shim.documentElement.getAttribute("data-theme"), "dark",
    "a theme arriving from another device must repaint, not just sit in state");
});

test("theme boot script: a 'dark' hint paints before the app loads", () => {
  assert.equal(runThemeBoot({ hint: "dark" }).getAttribute("data-theme"), "dark");
});

test("theme boot script: a 'light' hint paints before the app loads", () => {
  assert.equal(runThemeBoot({ hint: "light" }).getAttribute("data-theme"), "light");
});

test("theme boot script: no hint leaves the OS in charge", () => {
  assert.equal(runThemeBoot().getAttribute("data-theme"), null);
});

test("theme boot script: a junk hint is ignored rather than written through", () => {
  assert.equal(runThemeBoot({ hint: "banana" }).getAttribute("data-theme"), null);
  assert.equal(runThemeBoot({ hint: "system" }).getAttribute("data-theme"), null);
});

test("theme boot script: blocked localStorage does not throw and does not block the page", () => {
  assert.doesNotThrow(() => runThemeBoot({ throwingStorage: true }));
});

/* =====================================================================
   NIGHT MODE — Unit 3: the one-tap footer control & live OS reactivity
   ===================================================================== */
const themeBtnText = (shim) => shim.elements.get("themeBtn").textContent;

test("footer control: the page ships a tappable theme button wired to cycle-theme", () => {
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.match(footer, /data-act="cycle-theme"/, "the control must live in the footer, not the header");
  assert.match(footer, /id="themeBtn"/);
});

test("footer control: on 'system' the label names Auto and the theme it currently resolves to", async () => {
  const { ctx, shim } = await loadApp({ prefersDark: true });
  ctx.render();
  assert.match(themeBtnText(shim), /Auto/i);
  assert.match(themeBtnText(shim), /dark/i, "Auto should show what it is resolving to right now");
});

test("footer control: an explicit preference labels itself Light or Dark", async () => {
  const { ctx, shim } = await loadApp();
  ctx.setTheme("light");
  assert.match(themeBtnText(shim), /Light/i);
  assert.ok(!/Auto/i.test(themeBtnText(shim)), "an explicit choice must not still read as Auto");
  ctx.setTheme("dark");
  assert.match(themeBtnText(shim), /Dark/i);
});

test("cycle-theme: one tap moves system -> light -> dark and wraps back to system", async () => {
  const { ctx } = await loadApp();
  assert.equal(ctx.state.settings.theme, "system");
  ctx.onAction("cycle-theme", {});
  assert.equal(ctx.state.settings.theme, "light");
  ctx.onAction("cycle-theme", {});
  assert.equal(ctx.state.settings.theme, "dark");
  ctx.onAction("cycle-theme", {});
  assert.equal(ctx.state.settings.theme, "system", "the cycle must wrap, or Auto becomes unreachable");
});

test("cycle-theme: tapping repaints the root element as it goes", async () => {
  const { ctx, shim } = await loadApp();
  ctx.onAction("cycle-theme", {});
  assert.equal(shim.documentElement.getAttribute("data-theme"), "light");
  ctx.onAction("cycle-theme", {});
  assert.equal(shim.documentElement.getAttribute("data-theme"), "dark");
  ctx.onAction("cycle-theme", {});
  assert.equal(shim.documentElement.getAttribute("data-theme"), null);
});

test("footer control: carries an accessible label naming the next state, not just an icon", async () => {
  const { ctx, shim } = await loadApp();
  ctx.render();
  const btn = shim.elements.get("themeBtn");
  const label = btn.getAttribute("aria-label") || btn.getAttribute("title") || "";
  assert.ok(label.length > 0, "an icon-and-word button still needs a description for screen readers");
  assert.match(label, /light/i, "from Auto the next tap is Light, so say so");
});

test("reactivity: the app subscribes to the OS colour-scheme query at boot", async () => {
  const { shim } = await loadApp();
  assert.ok(shim.mqlListeners.length > 0, "without a subscription nothing can react to the OS flipping");
});

test("reactivity: flipping the OS while on Auto updates the label live", async () => {
  const { ctx, shim } = await loadApp({ prefersDark: false });
  ctx.render();
  assert.match(themeBtnText(shim), /light/i);
  shim.setDark(true);
  assert.match(themeBtnText(shim), /dark/i, "Auto must track the OS without a reload");
  shim.setDark(false);
  assert.match(themeBtnText(shim), /light/i, "and track it back again");
});

test("reactivity: flipping the OS while pinned to an explicit theme changes nothing", async () => {
  const { ctx, shim } = await loadApp({ prefersDark: false });
  ctx.setTheme("light");
  const before = themeBtnText(shim);
  shim.setDark(true);
  assert.equal(themeBtnText(shim), before, "an explicit choice must not be overridden by the OS");
  assert.equal(shim.documentElement.getAttribute("data-theme"), "light");
  assert.equal(ctx.resolvedTheme(), "light");
});

test("reactivity: booting without matchMedia wires up nothing and does not throw", async () => {
  const { ctx, shim } = await loadApp({ noMatchMedia: true });
  assert.doesNotThrow(() => ctx.render());
  assert.match(themeBtnText(shim), /Auto/i);
});

/* =====================================================================
   NIGHT MODE — Unit 4: the palette itself
   A dark mode is only as good as its least-converted colour. This guard
   walks every declaration in <style> and fails on any background, border,
   fill or accent that is still a hardcoded literal, which is how a stray
   white input box survives into a dark theme.
   ===================================================================== */
const styleSrc = slice(html, "<style>", "</style>").replace(/\/\*[\s\S]*?\*\//g, "");

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;
const WHITE_RE = /^(#fff|#ffffff|rgba?\(\s*255\s*,\s*255\s*,\s*255[^)]*\))$/i;
// Properties whose colour is decorative or sits on a saturated fill, so it is
// genuinely the same in both themes.
const INVARIANT_PROPS = new Set(["box-shadow", "text-decoration-color"]);
// Deliberate, reviewed exceptions. Each must justify itself.
const ALLOWED_DECLS = new Set([
  "background:rgba(28,26,50,.42)",   // modal scrim — dark over both themes by design
]);

function declarations() {
  const out = [];
  for (const [, body] of styleSrc.matchAll(/\{([^{}]*)\}/g)) {
    for (const chunk of body.split(";")) {
      const i = chunk.indexOf(":");
      if (i === -1) continue;
      const prop = chunk.slice(0, i).trim().toLowerCase();
      const value = chunk.slice(i + 1).trim();
      if (prop && value) out.push({ prop, value, text: prop + ":" + value.replace(/\s+/g, " ") });
    }
  }
  return out;
}

// Pulls the arguments out of every light-dark(...) in a value. Needs real
// paren balancing, not a regex: light-dark(rgba(...),rgba(...)) is legal and a
// lazy /\(([^)]*)\)/ would stop at the inner rgba's closing paren.
function lightDarkArgs(value) {
  const TAG = "light-dark(";
  const out = [];
  let i = 0;
  while ((i = value.indexOf(TAG, i)) !== -1) {
    let depth = 0, j = i + TAG.length - 1;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")" && --depth === 0) break;
    }
    out.push(value.slice(i + TAG.length, j));
    i = j + 1;
  }
  return out.join(",");
}

function offendingDeclarations() {
  const bad = [];
  for (const d of declarations()) {
    const literals = d.value.match(COLOR_RE);
    if (!literals) continue;
    if (INVARIANT_PROPS.has(d.prop)) continue;
    if (ALLOWED_DECLS.has(d.text.replace(/\s/g, ""))) continue;
    if (d.prop === "color" && literals.every((l) => WHITE_RE.test(l))) continue; // white on a saturated fill
    // Everything else must route its literals through light-dark().
    const insideLightDark = lightDarkArgs(d.value);
    const escaped = literals.filter((l) => !insideLightDark.includes(l));
    if (escaped.length) bad.push(`${d.text}   [escaped: ${escaped.join(", ")}]`);
  }
  return bad;
}

test("palette: :root opts into both schemes so the OS drives light-dark() unaided", () => {
  const root = styleSrc.slice(styleSrc.indexOf(":root{"), styleSrc.indexOf("}", styleSrc.indexOf(":root{")));
  assert.match(root.replace(/\s/g, ""), /color-scheme:lightdark/,
    "without this declaration light-dark() has nothing to resolve against");
});

test("palette: an explicit preference pins color-scheme in both directions", () => {
  const flat = styleSrc.replace(/\s/g, "");
  assert.match(flat, /\[data-theme="dark"\][^{]*\{[^}]*color-scheme:dark/);
  assert.match(flat, /\[data-theme="light"\][^{]*\{[^}]*color-scheme:light/);
});

test("palette: no background, border, fill or accent escapes light-dark()", () => {
  const bad = offendingDeclarations();
  assert.deepEqual(bad, [], `unconverted colours would render wrong in dark mode:\n  ${bad.join("\n  ")}`);
});

test("palette: the footer theme button is styled rather than inheriting bare button reset", () => {
  assert.match(styleSrc, /\.themebtn\s*\{/);
  assert.match(styleSrc, /\.themerow\s*\{/);
});

/* =====================================================================
   NIGHT MODE — Unit 5: the app's copy is English
   Checks characters, not words: anything outside plain ASCII must be a
   deliberate typographic mark or an icon glyph. \uXXXX escapes are decoded
   first, so writing foreign text the long way round is caught too.
   ===================================================================== */
const ALLOWED_NON_ASCII = new Set([
  "\u2014", "\u2013", "\u2026", "\u00b7", "\u2022",           // dashes, ellipsis, dots
  "\u2265", "\u2264", "\u2212", "\u00b1", "\u2248",           // maths
  "\u2192", "\u2193", "\u2197", "\u21ba", "\u21bb", "\u232b", // arrows & keycaps
  "\u2715", "\u2699", "\u25c9", "\u25a6", "\u{1f5d3}",        // icons
  "\u2713",                                                  // check mark, Done in the edit pane
  "\u25b6", "\u25b8", "\u25be", "\u25bc", "\u25cf",           // carets & bullets
  "\u25d0", "\u2600", "\u263e",                               // night-mode faces
  "\u2019",                                                   // English apostrophe ("Can't")
  "\u2601",                                                   // cloud-sync icon
]);

function decodeEscapes(src) {
  return src
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

test("copy: every non-ASCII character in the app is a permitted typographic or icon glyph", () => {
  const found = new Map();
  for (const ch of decodeEscapes(html)) {
    if (ch.codePointAt(0) > 127 && !ALLOWED_NON_ASCII.has(ch)) {
      found.set(ch, (found.get(ch) || 0) + 1);
    }
  }
  const report = [...found].map(([c, n]) => `U+${c.codePointAt(0).toString(16).toUpperCase()} ${JSON.stringify(c)} x${n}`);
  assert.deepEqual(report, [], `non-English or non-standard characters in the app:\n  ${report.join("\n  ")}`);
});

test("copy: the footer credit reads as English rather than a French idiom", () => {
  const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
  assert.ok(!/\u00e0 la/i.test(footer), "'a la' is French; say it in English");
  assert.match(footer, /spawelo/, "the credit itself must survive the rewording");
});

test("copy: the add-context button uses a plain ASCII plus, not a fullwidth one", () => {
  assert.match(html, /">\+ context</, "U+FF0B is a CJK-width form and renders oddly in a Latin UI");
});

/* =====================================================================
   NIGHT MODE — Unit 6: both palettes stay readable
   Dark mode is easy to ship and hard to ship legibly. These compute real
   WCAG contrast ratios from the tokens, in both themes, so a palette
   tweak cannot quietly push text under the line.
   ===================================================================== */
function themeTokens() {
  const rootBlock = styleSrc.slice(styleSrc.indexOf(":root{"), styleSrc.indexOf("*{box-sizing"));
  const light = {}, dark = {};
  for (const m of rootBlock.matchAll(/(--[a-z-]+)\s*:\s*light-dark\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g)) {
    light[m[1]] = m[2];
    dark[m[1]] = m[3];
  }
  return { light, dark };
}

function channel(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [description, foreground token, background token, minimum ratio]
const CONTRAST_PAIRS = [
  ["body text on the page",        "--ink",       "--bg",         4.5],
  ["body text on a panel",         "--ink",       "--panel",      4.5],
  ["muted secondary text",         "--mut",       "--bg",         4.5],
  ["links and accents",            "--accent",    "--bg",         4.5],
  ["white ink, top of chain card", "--chain-ink", "--chain",      3.0],
  ["white ink, foot of chain card","--chain-ink", "--chain-deep", 3.0],
  ["candidate card text",          "--cand-ink",  "--cand-bg",    4.5],
];

for (const [what, fg, bg, min] of CONTRAST_PAIRS) {
  for (const theme of ["light", "dark"]) {
    test(`contrast (${theme}): ${what} clears ${min}:1`, () => {
      const tokens = themeTokens()[theme];
      assert.ok(tokens[fg], `${fg} must be defined as a light-dark() pair`);
      assert.ok(tokens[bg], `${bg} must be defined as a light-dark() pair`);
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert.ok(ratio >= min,
        `${fg} on ${bg} in ${theme} is ${ratio.toFixed(2)}:1, below the ${min}:1 floor`);
    });
  }
}

// The Done button is a solid green fill carrying a white 14px bold label, which
// is not "large text" — so it has to clear the same 3:1 floor as the chain card.
// Read the token out of the rule rather than naming one here, so recolouring the
// button to something illegible goes red instead of quietly shipping.
test("contrast: white ink on the Done button fill clears 3:1 in both themes", () => {
  const m = styleSrc.match(/\.btn\.done\{background:var\((--[a-z-]+)\)\}/);
  assert.ok(m, "the Done button should be filled with a theme token");
  const token = m[1];
  for (const theme of ["light", "dark"]) {
    const tokens = themeTokens()[theme];
    assert.ok(tokens[token], `${token} must be defined as a light-dark() pair`);
    const ratio = contrast(tokens["--chain-ink"], tokens[token]);
    assert.ok(ratio >= 3.0,
      `white on ${token} in ${theme} is ${ratio.toFixed(2)}:1, below the 3:1 floor`);
  }
});

test("contrast: white ink on the 'Worked on it' button fill clears 3:1 in both themes", () => {
  const m = styleSrc.match(/\.btn\.worked\{background:var\((--[a-z-]+)\)/);
  assert.ok(m, "the Worked on it button should be filled with a theme token");
  const token = m[1];
  for (const theme of ["light", "dark"]) {
    const tokens = themeTokens()[theme];
    assert.ok(tokens[token], `${token} must be defined as a light-dark() pair`);
    const ratio = contrast(tokens["--chain-ink"], tokens[token]);
    assert.ok(ratio >= 3.0,
      `white on ${token} in ${theme} is ${ratio.toFixed(2)}:1, below the 3:1 floor`);
  }
});

test("contrast: the accent token is used for link text rather than the card-fill token", () => {
  assert.match(styleSrc, /\na\{color:var\(--accent\)\}/,
    "a fill tuned to sit under white ink is too dark to double as link text");
});

test("UX: first boot shows quick start modal automatically", async () => {
  const { ctx, shim } = await loadApp({ seed: 5 });
  assert.equal(ctx.state.seenQuickStart, undefined, "fresh state should not have seenQuickStart");
  const modalHtml = shim.elements.get("modalRoot").innerHTML;
  assert.ok(modalHtml.includes("Quick start"), "quick start modal should be open on first boot");
});

test("UX: first boot quick start has a green OK button", async () => {
  const { ctx, shim } = await loadApp({ seed: 5 });
  const modalHtml = shim.elements.get("modalRoot").innerHTML;
  assert.ok(modalHtml.includes('data-act="ok-quickstart"'), "quick start should have an OK button");
  assert.ok(modalHtml.includes('class="btn done"'), "OK button should have done (green) styling");
});

test("UX: clicking OK button closes modal and sets seenQuickStart flag", async () => {
  const { ctx, shim } = await loadApp({ seed: 5 });
  assert.equal(ctx.state.seenQuickStart, undefined, "initially undefined");
  ctx.onAction("ok-quickstart");
  assert.equal(ctx.state.seenQuickStart, true, "seenQuickStart should be true after clicking OK");
  const modalHtml = shim.elements.get("modalRoot").innerHTML;
  assert.equal(modalHtml, "", "modal should be closed after clicking OK");
});

test("UX: rescan button doesn't show when resume-scan is available", async () => {
  const { ctx, shim } = await loadApp({ seed: 42 });
  // Add tasks
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.addTask("Task C", false);
  ctx.startScan();  // dots Task A
  ctx.render();
  
  // Skip a task (decide "no")
  ctx.onAction("no");  // Task B gets skipped
  ctx.render();
  
  // Move to work mode
  ctx.onAction("start-working");
  ctx.render();
  
  const scanHtml = shim.elements.get("scan").innerHTML;
  
  // Resume scanning button should be present
  assert.match(scanHtml, /data-act="resume-scan"/, "resume-scan button should be present in work mode");
  
  // Rescan button should NOT be present when resume-scan is available
  assert.ok(!scanHtml.includes('data-act="rescan"'), "rescan button should NOT appear when resume-scan is available");
});

test("UX: resume-scan button is greyed during work mode if pool has eligible tasks", async () => {
  const { ctx, shim } = await loadApp({ seed: 42 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.addTask("Task C", false);
  ctx.startScan();  // dots Task A, mode stays "scan"
  ctx.onAction("start-working");  // switch to work mode
  ctx.render();
  
  const scanHtml = shim.elements.get("scan").innerHTML;
  
  // Find the resume-scan button's parent container
  const resumeMatch = scanHtml.match(/<button[^>]*data-act="resume-scan"[^>]*>Resume scanning<\/button>/);
  assert.ok(resumeMatch, "resume-scan button should exist when in work mode");
  
  // Check if the button or its container has disabled/greyed styling
  // For now, verify button exists (we'll check CSS/opacity in next assertion)
  const noticeMatch = scanHtml.match(/<div class="notice"[^>]*>[\s\S]*?resume-scan[\s\S]*?<\/div>/);
  assert.ok(noticeMatch, "resume-scan should be in a notice div");
});

test("UX: resume-scan button is full opacity once all eligible tasks are gone", async () => {
  const { ctx, shim } = await loadApp({ seed: 42 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.startScan();  // dots Task A
  ctx.decide("yes");  // select Task B, dot it
  ctx.decide("yes");  // no more tasks
  ctx.render();
  
  // Now we're in scan mode with no eligible tasks remaining
  const scanHtml = shim.elements.get("scan").innerHTML;
  
  // Move to work mode
  ctx.onAction("start-working");
  ctx.render();
  
  const scanHtml2 = shim.elements.get("scan").innerHTML;
  assert.ok(scanHtml2.includes('data-act="resume-scan"'), "resume-scan button should be present");
  // Button should be full opacity when no tasks remain
});

/* =====================================================================
   ALL-TASKS LIST: search by name, and filter by tag
   ---------------------------------------------------------------------
   Two independent controls sitting above the list body. Search matches
   the task title, case-insensitively. The tag filter offers only the
   contexts that are currently *active*, and lights exactly one at a time.
   Both are view-only: they never touch state.contexts[].active, so what's
   eligible for the scan is completely unaffected by what you're looking at.
   ===================================================================== */

function openList(ctx) {
  ctx.state.listOpen = true;
  ctx.render();
}
function listHTML(shim) {
  return shim.elements.get("listBody").innerHTML;
}
function listCount(shim) {
  return shim.elements.get("listCount").textContent;
}
function tagRowHTML(shim) {
  return shim.elements.get("listTagRow").innerHTML;
}
// The context ids of the tag buttons currently carrying the "on" class. Parses
// whole <button ...> tags so a neighbouring button's class can't bleed in.
function litTags(shim) {
  return [...tagRowHTML(shim).matchAll(/<button[^>]*>/g)]
    .map((m) => m[0])
    .filter((b) => /\bclass="[^"]*\bon\b[^"]*"/.test(b))
    .map((b) => (b.match(/data-id="([^"]+)"/) || [])[1]);
}

/* ---------- search by name ---------- */

test("list search: an empty query leaves every open task on the list", async () => {
  const { ctx, shim } = await loadApp({ seed: 900 });
  ctx.addTask("Write the scene", false);
  ctx.addTask("Fix the sink", false);
  openList(ctx);

  ctx.setListQuery("");
  const html = listHTML(shim);
  assert.match(html, /Write the scene/);
  assert.match(html, /Fix the sink/);
  assert.equal(listCount(shim), "(2)");
});

test("list search: a query narrows the list to titles containing it", async () => {
  const { ctx, shim } = await loadApp({ seed: 901 });
  ctx.addTask("Write the scene", false);
  ctx.addTask("Fix the sink", false);
  openList(ctx);

  ctx.setListQuery("sink");
  const html = listHTML(shim);
  assert.match(html, /Fix the sink/, `expected the matching task, got: ${html}`);
  assert.ok(!/Write the scene/.test(html), `non-matching task should be gone, got: ${html}`);
});

test("list search: matching is case-insensitive", async () => {
  const { ctx, shim } = await loadApp({ seed: 902 });
  ctx.addTask("Email the Union rep", false);
  openList(ctx);

  ctx.setListQuery("UNION");
  assert.match(listHTML(shim), /Email the Union rep/);
});

test("list search: surrounding whitespace in the query is ignored", async () => {
  const { ctx, shim } = await loadApp({ seed: 903 });
  ctx.addTask("Renew the car tag", false);
  ctx.addTask("Fix the sink", false);
  openList(ctx);

  ctx.setListQuery("   car   ");
  const html = listHTML(shim);
  assert.match(html, /Renew the car tag/);
  assert.ok(!/Fix the sink/.test(html), `whitespace shouldn't widen the match: ${html}`);
});

test("list search: a whitespace-only query counts as no filter at all", async () => {
  const { ctx, shim } = await loadApp({ seed: 904 });
  ctx.addTask("Write the scene", false);
  ctx.addTask("Fix the sink", false);
  openList(ctx);

  ctx.setListQuery("     ");
  const html = listHTML(shim);
  assert.match(html, /Write the scene/);
  assert.match(html, /Fix the sink/);
  assert.equal(listCount(shim), "(2)", "an empty filter shouldn't draw the filtered count");
});

test("list search: a query that matches nothing says so, rather than showing 'No open tasks'", async () => {
  const { ctx, shim } = await loadApp({ seed: 905 });
  ctx.addTask("Write the scene", false);
  openList(ctx);

  ctx.setListQuery("zzzzz");
  const html = listHTML(shim);
  assert.ok(!/No open tasks/.test(html), `there ARE open tasks — the message shouldn't claim otherwise: ${html}`);
  assert.match(html, /No tasks match/, `expected a distinct no-match message, got: ${html}`);
});

test("list search: the no-match state offers a button that clears the filters", async () => {
  const { ctx, shim } = await loadApp({ seed: 906 });
  ctx.addTask("Write the scene", false);
  openList(ctx);
  ctx.setListQuery("zzzzz");
  assert.match(listHTML(shim), /data-act="clear-list-filters"/);

  ctx.onAction("clear-list-filters", {});
  assert.match(listHTML(shim), /Write the scene/, "clearing should bring the task back");
});

test("list search: the header count shows how many of the total are showing", async () => {
  const { ctx, shim } = await loadApp({ seed: 907 });
  ctx.addTask("Write the scene", false);
  ctx.addTask("Fix the sink", false);
  ctx.addTask("Sink the fix", false);
  openList(ctx);
  assert.equal(listCount(shim), "(3)");

  ctx.setListQuery("sink");
  assert.equal(listCount(shim), "(2 of 3)");
});

test("list search: the query survives an unrelated re-render", async () => {
  const { ctx, shim } = await loadApp({ seed: 908 });
  ctx.addTask("Write the scene", false);
  ctx.addTask("Fix the sink", false);
  openList(ctx);
  ctx.setListQuery("sink");

  ctx.render();
  assert.ok(!/Write the scene/.test(listHTML(shim)), "a repaint shouldn't silently drop the filter");
});

test("list search: the search box lives outside #listBody, so a repaint can't steal focus", () => {
  const wrap = html.match(/<section class="panel listwrap"[\s\S]*?<\/section>/);
  assert.ok(wrap, "the list panel should still be a .listwrap section");
  const bodyIdx = wrap[0].indexOf('id="listBody"');
  const searchIdx = wrap[0].indexOf('id="listSearch"');
  assert.ok(searchIdx !== -1, "expected a #listSearch input in the static list markup");
  assert.ok(searchIdx < bodyIdx,
    "the search input must sit before (and outside) #listBody — renderList() rebuilds that body wholesale");
});

test("list search: typing in the box is wired to the filter", () => {
  const m = html.match(/document\.addEventListener\("input",[\s\S]*?\}\);/);
  assert.ok(m, "expected an input listener for the live search box");
  assert.match(m[0], /listSearch/, `the input listener should watch #listSearch: ${m && m[0]}`);
});

/* ---------- filter by the badges a row actually carries ----------
   The buttons in the FILTER row are the states you can see on the rows
   themselves: the skip marks (no / can't / dislodged / worked), the flags
   (evergreen, not started), the due states, and the contexts. One rule
   governs all of them — a button exists only when at least one open task
   would match it. Nothing offers you a filter that returns nothing. */

function tagLabels(shim) {
  return [...tagRowHTML(shim).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
}
function tagKeys(shim) {
  return [...tagRowHTML(shim).matchAll(/<button[^>]*data-id="([^"]+)"/g)].map((m) => m[1]);
}
function clickTag(ctx, key) {
  ctx.onAction("list-tag", { dataset: { id: key } });
}
function rowTitles(shim) {
  return [...listHTML(shim).matchAll(/data-act="edit"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
}

/* ---------- "where present": nothing offers an empty filter ---------- */

test("list filter row: a plain unmarked list offers no filter buttons at all", async () => {
  const { ctx, shim } = await loadApp({ seed: 940 });
  ctx.addTask("Write the scene", false);
  ctx.addTask("Fix the sink", false);
  openList(ctx);

  assert.deepEqual(tagLabels(shim), [],
    `nothing is marked, so there is nothing to filter by: ${tagRowHTML(shim)}`);
});

test("list filter row: a 'no' mark puts a no button on the row", async () => {
  const { ctx, shim } = await loadApp({ seed: 941 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  ctx.startScan();          // dots Task A, offers Task B
  ctx.decide("no");         // marks Task B 'no' through the real scan flow
  openList(ctx);

  assert.ok(tagLabels(shim).includes("no"), `expected a "no" button: ${tagRowHTML(shim)}`);
});

test("list filter row: an evergreen task puts an evergreen button on the row", async () => {
  const { ctx, shim } = await loadApp({ seed: 942 });
  const t = ctx.addTask("Water the plants", false);
  ctx.state.tasks.find((x) => x.id === t.id).evergreen = true;
  openList(ctx);

  assert.ok(tagLabels(shim).includes("evergreen"), `expected an "evergreen" button: ${tagRowHTML(shim)}`);
});

test("list filter row: a dislodged task puts a dislodged button on the row", async () => {
  const { ctx, shim } = await loadApp({ seed: 943 });
  const t = ctx.addTask("Shunted aside", false);
  ctx.state.considered[t.id] = "dislodged";
  openList(ctx);

  assert.ok(tagLabels(shim).includes("dislodged"), `expected a "dislodged" button: ${tagRowHTML(shim)}`);
});

test("list filter row: a can't mark and a worked mark each get their own button", async () => {
  const { ctx, shim } = await loadApp({ seed: 944 });
  const a = ctx.addTask("Blocked on someone", false);
  const b = ctx.addTask("Chipped away at it", false);
  ctx.state.considered[a.id] = "cant";
  ctx.state.considered[b.id] = "worked";
  openList(ctx);

  const labels = tagLabels(shim);
  assert.ok(labels.includes("can’t"), `expected a "can't" button: ${labels}`);
  assert.ok(labels.includes("worked"), `expected a "worked" button: ${labels}`);
});

test("list filter row: overdue, due today and not started each appear when a task is in that state", async () => {
  const { ctx, shim } = await loadApp({ seed: 945 });
  const a = ctx.addTask("Late thing", false);
  const b = ctx.addTask("Today thing", false);
  const c = ctx.addTask("Future thing", false);
  const find = (id) => ctx.state.tasks.find((x) => x.id === id);
  find(a.id).due = "2020-01-01";
  find(b.id).due = ctx.todayISO(0);
  find(c.id).startsAt = ctx.todayISO(30);
  openList(ctx);

  const labels = tagLabels(shim);
  assert.ok(labels.includes("overdue"), `expected "overdue": ${labels}`);
  assert.ok(labels.includes("due today"), `expected "due today": ${labels}`);
  assert.ok(labels.includes("not started"), `expected "not started": ${labels}`);
});

test("list filter row: a button disappears once the last task in that state loses it", async () => {
  const { ctx, shim } = await loadApp({ seed: 946 });
  const t = ctx.addTask("Shunted aside", false);
  ctx.state.considered[t.id] = "dislodged";
  openList(ctx);
  assert.ok(tagLabels(shim).includes("dislodged"), "precondition: the button is there");

  ctx.rescanSkipped();      // clears every skip mark
  ctx.render();
  assert.ok(!tagLabels(shim).includes("dislodged"),
    `an offer that would now return nothing should be withdrawn: ${tagRowHTML(shim)}`);
});

/* ---------- contexts share the row, under the same rule ---------- */

test("list filter row: a context carried by an open task is offered alongside the badges", async () => {
  const { ctx, shim } = await loadApp({ seed: 947 });
  ctx.addTask("Drive to the shop", false, ["c_car"]);
  openList(ctx);

  const labels = tagLabels(shim);
  assert.ok(labels.includes("Have the car"), `a context in use should be filterable: ${labels}`);
  assert.deepEqual(labels, ["Have the car"],
    `and only the one in use — the other five active contexts have no tasks: ${labels}`);
});

test("list filter row: contexts nobody uses stay off the row entirely", async () => {
  const { ctx, shim } = await loadApp({ seed: 948 });
  ctx.addTask("Write the scene", false);   // no contexts on it — the common case
  ctx.addTask("Fix the sink", false);
  openList(ctx);

  assert.deepEqual(tagLabels(shim), [],
    `six unused contexts shouldn't clutter the row: ${tagRowHTML(shim)}`);
});

test("list filter row: an inactive context isn't offered even when a task carries it", async () => {
  const { ctx, shim } = await loadApp({ seed: 949 });
  ctx.addTask("Drive to the shop", false, ["c_car"]);
  ctx.addTask("Write the scene", false, ["c_home"]);
  openList(ctx);
  assert.deepEqual(tagLabels(shim).sort(), ["At home", "Have the car"], "precondition: both are offered");

  ctx.toggleContext("c_car");
  assert.deepEqual(tagLabels(shim), ["At home"],
    `only active contexts are searchable: ${tagRowHTML(shim)}`);
});

test("list filter row: a context named after a badge doesn't collide with it", async () => {
  const { ctx, shim } = await loadApp({ seed: 950 });
  ctx.state.contexts.push({ id: "c_custom", name: "no", active: true });
  const tagged = ctx.addTask("Carries a context called no", false, ["c_custom"]);
  const marked = ctx.addTask("Actually marked no", false);
  ctx.state.considered[marked.id] = "no";
  openList(ctx);

  const keys = tagKeys(shim);
  assert.equal(new Set(keys).size, keys.length, `filter keys must be unique: ${keys}`);
  const ctxKey = keys.find((k) => k.includes("c_custom"));
  const statusKey = keys.find((k) => k !== ctxKey);
  clickTag(ctx, ctxKey);
  assert.deepEqual(rowTitles(shim), ["Carries a context called no"],
    "the context filter must not pick up the 'no'-marked task");
  clickTag(ctx, statusKey);
  assert.deepEqual(rowTitles(shim), ["Actually marked no"],
    "and the badge filter must not pick up the context-tagged one");
  assert.ok(tagged && marked);
});

/* ---------- what the buttons do ---------- */

test("list filter: clicking 'no' shows only the tasks marked no", async () => {
  const { ctx, shim } = await loadApp({ seed: 951 });
  const a = ctx.addTask("Said no to this", false);
  ctx.addTask("Untouched", false);
  ctx.state.considered[a.id] = "no";
  openList(ctx);

  clickTag(ctx, tagKeys(shim)[0]);
  assert.deepEqual(rowTitles(shim), ["Said no to this"]);
});

test("list filter: clicking 'evergreen' shows only the evergreen tasks", async () => {
  const { ctx, shim } = await loadApp({ seed: 952 });
  const a = ctx.addTask("Water the plants", false);
  ctx.addTask("One-off job", false);
  ctx.state.tasks.find((x) => x.id === a.id).evergreen = true;
  openList(ctx);

  clickTag(ctx, tagKeys(shim)[0]);
  assert.deepEqual(rowTitles(shim), ["Water the plants"]);
});

test("list filter: clicking a context shows only the tasks carrying it", async () => {
  const { ctx, shim } = await loadApp({ seed: 953 });
  ctx.addTask("Drive to the shop", false, ["c_car"]);
  ctx.addTask("Write the scene", false, ["c_home"]);
  openList(ctx);

  clickTag(ctx, "c:c_car");
  assert.deepEqual(rowTitles(shim), ["Drive to the shop"]);
});

test("list filter: clicking the lit button again clears it", async () => {
  const { ctx, shim } = await loadApp({ seed: 954 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.addTask("Untouched", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);

  const key = tagKeys(shim)[0];
  clickTag(ctx, key);
  assert.deepEqual(rowTitles(shim), ["Shunted aside"], "precondition: the filter is narrowing");
  clickTag(ctx, key);
  assert.equal(rowTitles(shim).length, 2, "toggling it off should restore the full list");
});

test("list filter: only one button is lit at a time, badge or context alike", async () => {
  const { ctx, shim } = await loadApp({ seed: 955 });
  const a = ctx.addTask("Shunted aside", false, ["c_car"]);
  ctx.addTask("Drive to the shop", false, ["c_car"]);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);

  clickTag(ctx, "s:dislodged");
  assert.deepEqual(litTags(shim), ["s:dislodged"]);
  clickTag(ctx, "c:c_car");
  assert.deepEqual(litTags(shim), ["c:c_car"], "picking a context should replace the badge filter, not add to it");
  assert.equal(rowTitles(shim).length, 2);
});

test("list filter: the lit button says so to a screen reader", async () => {
  const { ctx, shim } = await loadApp({ seed: 956 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);
  clickTag(ctx, "s:dislodged");

  const btn = tagRowHTML(shim).match(/<button[^>]*data-id="s:dislodged"[^>]*>/);
  assert.ok(btn, `expected the dislodged button: ${tagRowHTML(shim)}`);
  assert.match(btn[0], /aria-pressed="true"/, btn[0]);
});

test("list filter: a badge filter and the search box narrow together", async () => {
  const { ctx, shim } = await loadApp({ seed: 957 });
  const a = ctx.addTask("Wash the car", false);
  const b = ctx.addTask("Wash the dishes", false);
  const c = ctx.addTask("Drive to the shop", false);
  ctx.state.considered[a.id] = "no";
  ctx.state.considered[c.id] = "no";
  openList(ctx);

  clickTag(ctx, "s:no");
  ctx.setListQuery("wash");
  assert.deepEqual(rowTitles(shim), ["Wash the car"],
    "only the task that is both marked no and matches the query should survive");
  assert.ok(b);
});

test("list filter: the header count reports the narrowing", async () => {
  const { ctx, shim } = await loadApp({ seed: 958 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.addTask("Untouched", false);
  ctx.addTask("Also untouched", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);
  assert.equal(listCount(shim), "(3)");

  clickTag(ctx, "s:dislodged");
  assert.equal(listCount(shim), "(1 of 3)");
});

/* ---------- a filter can't outlive what it points at ---------- */

test("list filter: clearing the skip marks drops a badge filter that pointed at one", async () => {
  const { ctx, shim } = await loadApp({ seed: 959 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.addTask("Untouched", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);
  clickTag(ctx, "s:dislodged");
  assert.equal(rowTitles(shim).length, 1, "precondition: the filter is narrowing");

  ctx.rescanSkipped();
  ctx.render();
  assert.equal(rowTitles(shim).length, 2, "the list mustn't stay stuck behind a filter that no longer exists");
  assert.deepEqual(litTags(shim), []);
});

test("list filter: deactivating the filtered context drops the filter", async () => {
  const { ctx, shim } = await loadApp({ seed: 960 });
  ctx.addTask("Drive to the shop", false, ["c_car"]);
  ctx.addTask("Write the scene", false, ["c_home"]);
  openList(ctx);
  clickTag(ctx, "c:c_car");
  assert.equal(rowTitles(shim).length, 1, "precondition: the filter is narrowing");

  ctx.toggleContext("c_car");
  assert.equal(rowTitles(shim).length, 2);
  assert.ok(!tagKeys(shim).includes("c:c_car"), "and the button should be gone");
});

test("list filter: deleting the filtered context drops the filter", async () => {
  const { ctx, shim } = await loadApp({ seed: 961 });
  ctx.addTask("Drive to the shop", false, ["c_car"]);
  ctx.addTask("Write the scene", false, ["c_home"]);
  openList(ctx);
  clickTag(ctx, "c:c_car");
  assert.equal(rowTitles(shim).length, 1, "precondition: the filter is narrowing");

  ctx.onAction("del-ctx", { dataset: { id: "c_car" } });
  ctx.render();
  assert.equal(rowTitles(shim).length, 2);
});

test("list filter: completing the only task in a filtered state drops the filter", async () => {
  const { ctx, shim } = await loadApp({ seed: 962 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.addTask("Untouched", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);
  clickTag(ctx, "s:dislodged");
  assert.deepEqual(rowTitles(shim), ["Shunted aside"], "precondition: the filter is narrowing");

  ctx.doneTask(a.id);
  assert.equal(rowTitles(shim).length, 1, "the one remaining open task should be visible, not filtered away");
  assert.deepEqual(litTags(shim), []);
});

/* ---------- still a view, not a mode ---------- */

test("list filter: filtering the view never changes which contexts are active", async () => {
  const { ctx, shim } = await loadApp({ seed: 963 });
  ctx.addTask("Drive to the shop", false, ["c_car"]);
  ctx.state.listOpen = true; ctx.render();
  const before = ctx.state.contexts.map((c) => [c.id, c.active]);

  clickTag(ctx, "c:c_car");
  assert.deepEqual(litTags(shim), ["c:c_car"], "precondition: the context filter is on");
  ctx.setListQuery("drive");

  assert.deepEqual(ctx.state.contexts.map((c) => [c.id, c.active]), before,
    "the list filter is a view, not a context switch");
});

test("list filter: filtering the view doesn't change what's eligible to scan", async () => {
  const { ctx, shim } = await loadApp({ seed: 964 });
  const a = ctx.addTask("Drive to the shop", false, ["c_car"]);
  ctx.addTask("Write the scene", false, ["c_home"]);
  ctx.state.considered[a.id] = "no";
  ctx.state.listOpen = true; ctx.render();
  const before = ctx.eligibleTasks().length;

  clickTag(ctx, "s:no");
  assert.deepEqual(rowTitles(shim), ["Drive to the shop"], "precondition: the view is narrowed to the no-marked task");
  assert.equal(ctx.eligibleTasks().length, before, "eligibility is a scan concept, not a view concept");
});

test("list filter: nothing about the filters is written into state", async () => {
  const { ctx, shim } = await loadApp({ seed: 965 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.state.considered[a.id] = "dislodged";
  ctx.state.listOpen = true; ctx.render();

  clickTag(ctx, "s:dislodged");
  assert.deepEqual(litTags(shim), ["s:dislodged"], "precondition: the filter is on");
  ctx.setListQuery("shunt");

  const json = JSON.stringify(ctx.state);
  assert.ok(!/listQuery|listTagFilter/.test(json), "the filters are UI-only and must not be persisted or synced");
});

test("list filter: undo doesn't restore an old filter, because filters aren't undoable state", async () => {
  const { ctx, shim } = await loadApp({ seed: 966 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.addTask("Untouched", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);
  clickTag(ctx, "s:dislodged");
  assert.deepEqual(litTags(shim), ["s:dislodged"], "precondition: the filter is lit");

  ctx.addTask("Third thing", false);   // an undoable action taken *after* the mark
  ctx.undo();                          // walks that back; the dislodged mark is inside the snapshot

  assert.deepEqual(litTags(shim), ["s:dislodged"], "undo walks back state, not what you're looking at");
  assert.deepEqual(rowTitles(shim), ["Shunted aside"], "and the view stays where you left it");
});

/* The one case where undo *does* clear a filter: when the thing being undone is
   the mark the filter was pointing at. That isn't undo touching the view — it's
   the same rule as everywhere else, an offer that would now return nothing. */
test("list filter: undoing the mark a filter points at takes the filter with it", async () => {
  const { ctx, shim } = await loadApp({ seed: 971 });
  ctx.addTask("Task A", false);
  ctx.addTask("Task B", false);
  openList(ctx);                       // before the marking step, so undo's snapshot has the list open
  ctx.startScan();
  ctx.decide("no");                    // marks one 'no' — an undoable step
  clickTag(ctx, "s:no");
  assert.deepEqual(litTags(shim), ["s:no"], "precondition: the filter is lit");

  ctx.undo();                          // takes the 'no' mark back off
  assert.deepEqual(litTags(shim), [], "with nothing marked no, the button and its filter both go");
  assert.equal(rowTitles(shim).length, 2, "and the full list comes back rather than showing nothing");
});

/* ---------- revealing a task has to beat the filter ---------- */

test("revealTask: clears the list filters so the task it reveals is actually visible", async () => {
  const { ctx, shim } = await loadApp({ seed: 967 });
  const a = ctx.addTask("Shunted aside", false);
  const scene = ctx.addTask("Write the scene", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);
  clickTag(ctx, "s:dislodged");
  ctx.setListQuery("shunt");
  assert.ok(!rowTitles(shim).includes("Write the scene"), "precondition: the scene is filtered out");

  ctx.revealTask(scene.id);
  assert.ok(rowTitles(shim).includes("Write the scene"),
    "revealing a task you can't see is a no-op — the filters have to give way");
});

/* ---------- the surrounding chrome ---------- */

test("list filters: the filter bar is hidden while the list is collapsed", async () => {
  const { ctx, shim } = await loadApp({ seed: 968 });
  ctx.addTask("Write the scene", false);
  ctx.state.listOpen = false;
  ctx.render();
  assert.equal(shim.elements.get("listFilters").hidden, true);

  openList(ctx);
  assert.equal(shim.elements.get("listFilters").hidden, false);
});

test("list filter row: the chip row is labelled when it has anything to offer", async () => {
  const { ctx, shim } = await loadApp({ seed: 969 });
  const a = ctx.addTask("Shunted aside", false);
  ctx.state.considered[a.id] = "dislodged";
  openList(ctx);

  const row = tagRowHTML(shim);
  assert.match(row, /class="ltaglabel"/, `expected a label on the filter chip row: ${row}`);
  assert.match(row, /Filter/i, `the label should say what the row does: ${row}`);

  const label = row.match(/<[^>]*class="ltaglabel"[^>]*>/);
  assert.ok(!/data-act=/.test(label[0]), `the label is a caption, not a control: ${label[0]}`);
});

test("list filter row: no label either when there's nothing to filter by", async () => {
  const { ctx, shim } = await loadApp({ seed: 970 });
  ctx.addTask("Write the scene", false);
  openList(ctx);

  assert.equal(tagRowHTML(shim), "",
    "an empty row shouldn't leave a stray FILTER caption sitting above the list");
});

/* =====================================================================
   REGRESSION: A STALE DEVICE MUST NOT OVERWRITE A NEWER CLOUD STATE

   The incident: a browser holding weeks-old localStorage was opened and
   its stale chain replaced a chain that had been built up in the cloud
   over a full day of work on another device. Three separate defects in
   the sync glue each allow that on their own.

   1. CS.pull() returned null both for "the document does not exist" and
      for "the read threw", and cloudPull() read null as an empty cloud
      and seeded it from this device. One flaky first request on a stale
      tab was enough to overwrite a perfectly good remote document.

   2. Pushes were gated only on "is auth ready", never on "has this
      session actually seen the cloud yet". cloudPushNow() (dotting,
      deleting) fires with no comparison at all, so an edit made in the
      seconds before the first pull landed wrote stale content straight
      over the remote.

   3. save() stamps state.updatedAt = Date.now() on every local write.
      On a device that had not reconciled yet, that put a fresh timestamp
      on weeks-old content, which then won the last-write-wins comparison
      in cloudPull() — so the stale side was declared "ahead" and pushed
      deliberately, not just by racing.

   The fix has to close all three: a failed read is not an empty cloud,
   nothing is written before the session reconciles once, and the first
   reconcile judges this device by the timestamp it LOADED with rather
   than one a local edit has since re-stamped.
   ===================================================================== */

const SYNC_STORE_KEY = "fvp:chain-scanner:v1";
const HOUR = 3600000;

const syncTask = (id, title) => ({
  id, title, url: null, due: null, evergreen: false, ctx: [],
  mu: 25, sigma: 25 / 3, done: false, createdAt: 1, completedAt: null, lastDoneAt: null,
});

/* A complete, valid saved state — the shape loadState() reads off disk and
   the shape a remote payload carries. `passStartedAt: 0` keeps the boot-time
   stale-pass recycle out of these tests; it isn't what's under test here. */
const syncState = (over = {}) => Object.assign({
  v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, workedAt: {},
  candidateId: null, workLog: [], interventionActive: false, interventionP: 0, snooze: 0,
  mode: "scan", decisionsMs: [], presentedAt: 0, passStartedAt: 0,
  listOpen: false, ctxOpen: true, histOpen: false, seenQuickStart: true, updatedAt: 0,
  settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, workedHours: 8, theme: "system" },
}, over);

/* The weeks-old copy sitting in the stale browser. */
const STALE_CHAIN = ["t_old"];
const staleState = (updatedAt) => syncState({
  tasks: [syncTask("t_old", "Something from last month")],
  chain: STALE_CHAIN.slice(), updatedAt,
});

/* The chain built up over today's work, living in the cloud. */
const CLOUD_CHAIN = ["t_day_a", "t_day_b", "t_day_c"];
const cloudState = (updatedAt) => syncState({
  tasks: [syncTask("t_day_a", "Draft the chapter"), syncTask("t_day_b", "Call the bank"), syncTask("t_day_c", "Fix the gate")],
  chain: CLOUD_CHAIN.slice(), updatedAt,
});

/* A CloudSync double with a real backing document, so a test can assert what
   actually survives in the cloud rather than which methods were called.
   pull() mirrors the module's contract: a well-formed {payload, updatedAt}
   when the document exists, {empty:true} when it provably does not, and
   {error:true} when the read failed and we therefore know nothing. */
function makeSyncHarness({ delayMs = 4, remote = null, failPull = false, rev = null } = {}) {
  const h = {
    doc: remote
      ? { payload: JSON.stringify(remote), updatedAt: remote.updatedAt, ...(rev === null ? {} : { rev }) }
      : null,
    failPull,
    calls: [],
    conflicts: 0,
    remoteState() { return h.doc ? JSON.parse(h.doc.payload) : null; },
    remoteChain() { const s = h.remoteState(); return s ? s.chain : null; },
    remoteTitles() { const s = h.remoteState(); return s ? s.tasks.map((t) => t.title) : null; },
    // Stands in for another device writing behind this one's back.
    writeBehindBack(state) {
      h.doc = { payload: JSON.stringify(state), updatedAt: state.updatedAt,
                rev: (h.doc && h.doc.rev ? h.doc.rev : 0) + 1 };
    },
    factory: () => ({
      configured: true, ready: true, user: "e@example.com", status: "ok",
      signIn() {}, signOut() {},
      async pull() {
        h.calls.push("pull");
        await new Promise((r) => setTimeout(r, delayMs));
        if (h.failPull) return { error: true };
        return h.doc ? { ...h.doc } : { empty: true };
      },
      // Mirrors the module's conditional write: the transaction refuses to
      // overwrite a revision the caller never read.
      async push(payload, updatedAt, baseRev) {
        h.calls.push("push");
        await new Promise((r) => setTimeout(r, delayMs));
        const cur = h.doc && h.doc.rev ? h.doc.rev : 0;
        if (h.doc && baseRev !== undefined && cur !== baseRev) { h.conflicts++; return { conflict: true, rev: cur }; }
        h.doc = { payload, updatedAt, rev: cur + 1 };
        return { ok: true, rev: cur + 1 };
      },
    }),
  };
  return h;
}

const syncSettle = (ms) => new Promise((r) => setTimeout(r, ms));
const PAST_DEBOUNCE = 2300;   // longer than cloudPush()'s 2s debounce

/* ---- defect 3: a fresh timestamp on stale content must not win ---- */

test("REGRESSION: an edit made before the first reconcile must not let weeks-old content outrank the cloud", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx } = await loadApp({
    seed: 971,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });
  assert.deepEqual(ctx.state.chain, STALE_CHAIN, "boots from the stale local copy");

  // A single click in the stale tab. save() re-stamps updatedAt to now, which
  // is the whole trap: the content is a month old, the timestamp is not.
  ctx.addTask("Typed into the stale tab", false);
  await ctx.cloudPull();

  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN,
    "the day's cloud chain must win the first reconcile, not the freshly re-stamped stale one");
});

test("REGRESSION: a dot racing the session's first pull must not overwrite the cloud chain", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), delayMs: 20 });
  const { ctx } = await loadApp({
    seed: 972,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  const pull = ctx.cloudPull();          // the session's first reconcile, still in flight
  ctx.addTask("Dotted mid-pull", true);  // a dot takes cloudPushNow() — no debounce, no comparison
  await pull;
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(h.remoteChain(), CLOUD_CHAIN,
    "a write racing the first pull must not land the stale chain in the cloud");
});

/* ---- defect 2: nothing may be written before the session reconciles ---- */

test("REGRESSION: no cloud write goes out before this session has pulled once", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx } = await loadApp({
    seed: 973,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  ctx.addTask("Dotted before anything pulled", true);   // immediate-sync path
  await syncSettle(PAST_DEBOUNCE);

  const firstPush = h.calls.indexOf("push");
  if (firstPush !== -1) {
    const firstPull = h.calls.indexOf("pull");
    assert.ok(firstPull !== -1 && firstPull < firstPush,
      `a write must be preceded by a reconcile, got: ${h.calls.join(",")}`);
  }
  assert.deepEqual(h.remoteChain(), CLOUD_CHAIN,
    "an unreconciled device must leave the remote chain alone");
});

/* ---- defect 1: a failed read is not an empty cloud ---- */

test("REGRESSION: a cloud read that failed must not be seeded over as if the cloud were empty", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), failPull: true });
  const { ctx } = await loadApp({
    seed: 974,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(!h.calls.includes("push"),
    `a read we could not complete tells us nothing — it must not authorise a write: ${h.calls.join(",")}`);
  assert.deepEqual(h.remoteChain(), CLOUD_CHAIN, "the remote document must be untouched");
  assert.deepEqual(ctx.state.chain, STALE_CHAIN, "and local must be left alone too");
});

/* ---- the fix must not over-correct: legitimate pushes still go out ---- */

test("a device that loaded genuinely newer data than the cloud still wins the reconcile", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now - 6 * HOUR) });
  const { ctx } = await loadApp({
    seed: 975,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now)) },   // offline edits, newer than the cloud
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(ctx.state.chain, STALE_CHAIN, "this device is ahead — it keeps its own state");
  assert.deepEqual(h.remoteChain(), STALE_CHAIN, "and pushes it to the cloud");
});

test("an empty cloud is still seeded from this device", async () => {
  const h = makeSyncHarness({ remote: null });
  const { ctx } = await loadApp({
    seed: 976,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(Date.now())) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(h.remoteState(), "a cloud with provably no document gets created from this device");
  assert.deepEqual(h.remoteChain(), STALE_CHAIN);
});

test("after reconciling once, ordinary edits keep syncing normally", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx } = await loadApp({
    seed: 977,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                 // adopts the cloud chain
  await syncSettle(PAST_DEBOUNCE);
  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN);

  const t = ctx.addTask("Real work, post-reconcile", true);   // now a legitimate local edit
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(h.remoteChain(), CLOUD_CHAIN.concat([t.id]),
    "once the session has seen the cloud, its writes must reach it again");
});

test("REGRESSION: signing in as a different account re-arms the gate — no write before reading that account's copy", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx, shim } = await loadApp({
    seed: 978,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                     // reconciled as e@example.com
  await syncSettle(PAST_DEBOUNCE);
  const afterFirst = h.calls.length;

  shim.window.CloudSync.user = "someone-else@example.com";   // signed out, signed back in as another account
  h.doc = { payload: JSON.stringify(cloudState(now + HOUR)), updatedAt: now + HOUR };

  ctx.addTask("Dotted right after the account switch", true);
  await syncSettle(PAST_DEBOUNCE);

  const after = h.calls.slice(afterFirst);
  assert.equal(after[0], "pull",
    `the new account's document must be read before it is written: ${after.join(",")}`);
});

test("adopting a newer remote over unsaved local edits says so, so the edits don't just vanish", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx, shim } = await loadApp({
    seed: 979,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  ctx.addTask("Typed into the stale tab", false);
  await ctx.cloudPull();

  const el = shim.elements.get("toast");
  assert.ok(el && /out of date/i.test(el.textContent),
    `expected a notice that this tab was replaced, got: ${el && el.textContent}`);
  assert.match(el.textContent, /↺/, "and it should point at undo as the way back");

  ctx.undo();
  assert.deepEqual(ctx.state.chain, STALE_CHAIN, "undo really does take the adoption back");
});

test("a silent adopt stays silent when there was nothing local to lose", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx, shim } = await loadApp({
    seed: 980,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();          // no local edit first — the ordinary catch-up case

  const el = shim.elements.get("toast");
  assert.ok(!el || !el.textContent, `an uneventful catch-up shouldn't nag: ${el && el.textContent}`);
  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN);
});

/* =====================================================================
   REGRESSION: AN IMPORT MUST NOT RESURRECT COMPLETED TASKS

   importList() deduped against openTasks() — state.tasks.filter(!done) —
   so a completed task was invisible to the check. Re-pasting a list kept
   somewhere else (the README's Obsidian workflow) therefore re-added, as
   brand-new open tasks, every line that had already been crossed off and
   was sitting right there in the History pane.
   ===================================================================== */

test("REGRESSION: importing a list does not re-add tasks already completed", async () => {
  const { ctx } = await loadApp({ seed: 981 });
  const t = ctx.addTask("Email the union rep", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  assert.equal(ctx.state.tasks.filter((x) => x.done).length, 1, "it is done, and in History");

  const r = ctx.importList("1. Email the union rep\n2. Fix the sink");

  assert.equal(r.added, 1, "only the genuinely new line is added");
  assert.deepEqual(Array.from(ctx.state.tasks.filter((x) => !x.done), (x) => x.title), ["Fix the sink"],
    "the completed task must not come back to the all-tasks list");
  assert.equal(ctx.state.tasks.filter((x) => x.done).length, 1, "and its History entry is untouched");
});

test("REGRESSION: a completed match is reported separately, not silently dropped", async () => {
  const { ctx } = await loadApp({ seed: 982 });
  const t = ctx.addTask("Email the union rep", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  ctx.addTask("Fix the sink", false);

  const r = ctx.importList("1. Email the union rep\n2. Fix the sink\n3. Call the bank");

  assert.equal(r.added, 1);
  assert.equal(r.skipped, 1, "the open duplicate");
  assert.equal(r.completed, 1, "the one already crossed off");

  const msg = ctx.importSummary(r.added, r.skipped, r.completed);
  assert.match(msg, /already (done|completed|crossed off)/i,
    `the summary has to say why a line didn't land: ${msg}`);
});

test("importList: completed dedupe is case- and whitespace-insensitive too", async () => {
  const { ctx } = await loadApp({ seed: 983 });
  const t = ctx.addTask("Email the union rep", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));

  const r = ctx.importList("1.   EMAIL   THE  UNION REP  ");
  assert.equal(r.added, 0);
  assert.equal(r.completed, 1);
});

test("importList: clearing History lets a re-paste legitimately add the task again", async () => {
  const { ctx } = await loadApp({ seed: 984 });
  const t = ctx.addTask("Email the union rep", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  ctx.clearCompleted();          // the record is gone, so there is nothing left to dedupe against

  const r = ctx.importList("1. Email the union rep");
  assert.equal(r.added, 1, "with no History entry, re-adding it is the right call");
});

test("addTask: typing a completed title by hand still adds it — an explicit act, not a stale paste", async () => {
  const { ctx } = await loadApp({ seed: 985 });
  const t = ctx.addTask("Email the union rep", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));

  const again = ctx.addTask("Email the union rep", false);
  assert.ok(again, "a deliberate single add is never blocked");
  assert.equal(ctx.state.tasks.filter((x) => !x.done).length, 1);
});

/* =====================================================================
   HISTORY RECONCILE: NO REPEATED COMPLETIONS THAT AREN'T REAL

   Fallout of the import bug above: a task crossed off, then re-added by a
   re-paste, then crossed off again, leaves two "done" rows in History for
   one accomplishment. reconcileHistory() sweeps those together on the same
   schedule as the can't/worked expiries. Two repeats are legitimate and
   must survive: evergreen completions (recurring by design) and a task
   deliberately restored from History and done again.
   ===================================================================== */

const doneTitles = (ctx) =>
  Array.from(ctx.state.tasks.filter((t) => t.done), (t) => t.title).sort();

// The exact shape the import bug produced: two task objects, same title, both done.
function seedDuplicateCompletion(ctx, title) {
  const a = ctx.addTask(title, false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === a.id));
  const b = { ...ctx.state.tasks.find((x) => x.id === a.id), id: a.id + "_dupe" };
  ctx.state.tasks.push(b);
  return { first: a.id, second: b.id };
}

test("reconcileHistory: two done rows for the same title collapse to one", async () => {
  const { ctx } = await loadApp({ seed: 986 });
  seedDuplicateCompletion(ctx, "Email the union rep");
  assert.equal(doneTitles(ctx).length, 2, "the duplicate is there to start with");

  ctx.reconcileHistory();

  assert.deepEqual(doneTitles(ctx), ["Email the union rep"]);
  assert.equal(ctx.historyRows().filter((r) => r.kind === "done").length, 1,
    "History shows one entry for one accomplishment");
});

test("reconcileHistory: keeps the original completion, drops the later artifact", async () => {
  const { ctx } = await loadApp({ seed: 987 });
  const a = ctx.addTask("Email the union rep", false);
  const first = ctx.state.tasks.find((x) => x.id === a.id);
  ctx.completeTask(first);
  first.completedAt = 1000;
  ctx.state.tasks.push({ ...first, id: "later", completedAt: 9000 });

  ctx.reconcileHistory();

  const rows = ctx.historyRows().filter((r) => r.kind === "done");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].at, 1000, "the first time you finished it is the real record");
});

test("reconcileHistory: leaves distinct titles alone", async () => {
  const { ctx } = await loadApp({ seed: 988 });
  for (const title of ["Email the union rep", "Fix the sink", "Call the bank"]) {
    const t = ctx.addTask(title, false);
    ctx.completeTask(ctx.state.tasks.find((x) => x.id === t.id));
  }
  ctx.reconcileHistory();
  assert.equal(doneTitles(ctx).length, 3, "three different things done is three entries");
});

test("reconcileHistory: evergreen repeats survive — recurring is the whole point", async () => {
  const { ctx } = await loadApp({ seed: 989 });
  const t = ctx.addTask("Water the plants", false);
  const task = ctx.state.tasks.find((x) => x.id === t.id);
  task.evergreen = true;
  ctx.completeTask(task);
  ctx.completeTask(task);
  ctx.completeTask(task);

  ctx.reconcileHistory();

  const rows = ctx.historyRows().filter((r) => r.kind === "evergreen-done");
  assert.equal(rows.length, 3, "every evergreen completion stays in History");
  assert.equal(ctx.state.tasks.filter((x) => x.done).length, 0, "and it never went done in the first place");
});

test("reconcileHistory: a task restored from History and done again keeps both records", async () => {
  const { ctx } = await loadApp({ seed: 990 });
  const a = ctx.addTask("Email the union rep", false);
  const first = ctx.state.tasks.find((x) => x.id === a.id);
  ctx.completeTask(first);
  first.completedAt = 1000;

  // Restored deliberately from the History pane, then done again — a second,
  // genuine accomplishment, marked as such by restoredAt.
  ctx.state.tasks.push({ ...first, id: "redone", completedAt: 9000, restoredAt: 5000 });

  ctx.reconcileHistory();

  assert.equal(ctx.historyRows().filter((r) => r.kind === "done").length, 2,
    "a deliberate restore-and-redo is a real repeat, not an artifact");
});

test("reconcileHistory: dropping a duplicate takes its dangling references with it", async () => {
  const { ctx } = await loadApp({ seed: 991 });
  const { second } = seedDuplicateCompletion(ctx, "Email the union rep");
  ctx.state.chain.push(second);
  ctx.state.considered[second] = "no";
  ctx.state.candidateId = second;

  ctx.reconcileHistory();

  assert.ok(!ctx.state.chain.includes(second), "no dead id left on the chain");
  assert.ok(!(second in ctx.state.considered), "no dead mark left behind");
  assert.equal(ctx.state.candidateId, null, "and it isn't left as the candidate");
});

test("reconcileHistory: runs on the ordinary sweep schedule, not only when asked", async () => {
  const { ctx } = await loadApp({ seed: 992 });
  seedDuplicateCompletion(ctx, "Email the union rep");
  assert.equal(doneTitles(ctx).length, 2);

  ctx.ensureCandidate();   // the same pass that expires can't/worked marks

  assert.equal(doneTitles(ctx).length, 1, "the regular check catches it without being invoked by hand");
});

test("the History restore button marks the task as deliberately restored", async () => {
  const { ctx } = await loadApp({ seed: 993 });
  const a = ctx.addTask("Email the union rep", false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === a.id));

  ctx.onAction("restore", { dataset: { id: a.id } });

  const t = ctx.state.tasks.find((x) => x.id === a.id);
  assert.equal(t.done, false, "it comes back to the all-tasks list");
  assert.ok(typeof t.restoredAt === "number", "and is stamped, so a later re-completion is respected");
});

/* =====================================================================
   REGRESSION: DEVICE CLOCKS MUST NOT DECIDE WHO WINS

   Second incident: a laptop's older history replaced a phone's newer one,
   including task renames. state.updatedAt is stamped with Date.now() — the
   writing device's OWN clock — and the two sides were compared directly.
   A laptop running minutes or hours ahead therefore "wins" every reconcile
   no matter how stale its content is, and no amount of care around when we
   write fixes an ordering that was never trustworthy to begin with.

   The document now carries a revision counter the devices agree on, and
   each device remembers which revision its copy is based on. Ahead/behind
   is a question about revisions, not clocks. Writes are conditional on the
   revision the device actually read, so a push cannot overwrite a revision
   it never saw — which also closes the case of two devices pushing at once.
   ===================================================================== */

const renamedCloud = (rev, title) => cloudState(0 /* clock is irrelevant now */),
      titlesOf = (ctx) => Array.from(ctx.state.tasks, (t) => t.title);

test("REGRESSION: a device whose clock runs ahead cannot overwrite a newer revision", async () => {
  const now = Date.now();
  // The phone's work, at revision 12.
  const phone = cloudState(now - 6 * HOUR);
  phone.tasks[0].title = "Draft the chapter (renamed on my phone)";
  const h = makeSyncHarness({ remote: phone, rev: 12 });

  // The laptop: older content, revision 5, and a clock running hours FAST —
  // so by timestamp alone it looks newer than everything the phone did.
  const stale = staleState(now + 6 * HOUR);
  stale.syncRev = 5;
  const { ctx } = await loadApp({
    seed: 994,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(stale) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(titlesOf(ctx).includes("Draft the chapter (renamed on my phone)"),
    `the laptop must take the phone's newer revision, whatever its clock says: ${titlesOf(ctx)}`);
  assert.ok(h.remoteTitles().includes("Draft the chapter (renamed on my phone)"),
    "and the rename must still be in the cloud afterwards");
});

test("REGRESSION: a rename made on another device is not undone by a stale push", async () => {
  const now = Date.now();
  const phone = cloudState(now);
  phone.tasks[1].title = "Call the credit union";
  const h = makeSyncHarness({ remote: phone, rev: 9 });

  const stale = staleState(now + 3 * HOUR);   // fast clock again
  stale.syncRev = 4;
  const { ctx } = await loadApp({
    seed: 995,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(stale) },
    cloudSyncFactory: h.factory,
  });

  ctx.addTask("Something typed on the laptop", true);   // and it tries to write
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(h.remoteTitles().includes("Call the credit union"),
    `the phone's rename must survive: ${h.remoteTitles()}`);
});

test("the revision this device last saw, not its clock, decides that it is ahead", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now + 6 * HOUR), rev: 7 });   // cloud clock ahead

  const local = staleState(now);            // slow clock, but same revision as the cloud
  local.syncRev = 7;
  const { ctx } = await loadApp({
    seed: 996,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(ctx.state.chain, STALE_CHAIN,
    "same base revision plus local edits means this device is ahead, slow clock or not");
  assert.deepEqual(h.remoteChain(), STALE_CHAIN, "so its work goes up");
});

test("REGRESSION: a push cannot overwrite a revision this device never read", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 3 });
  const local = staleState(now);
  local.syncRev = 3;
  const { ctx } = await loadApp({
    seed: 997,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                    // in sync at revision 3
  await syncSettle(PAST_DEBOUNCE);

  // Another device writes revision 4 while this one wasn't looking.
  const elsewhere = cloudState(now + HOUR);
  elsewhere.tasks[0].title = "Written from the other device";
  h.writeBehindBack(elsewhere);

  ctx.addTask("Typed here, unaware", false);
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(h.remoteTitles().includes("Written from the other device"),
    `the unseen revision must not be clobbered: ${h.remoteTitles()}`);
  assert.ok(h.conflicts > 0, "the conditional write is what refused it");
});

test("the revision a device is based on is device-local, never part of the shared document", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 2 });
  const { ctx } = await loadApp({
    seed: 998,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                    // adopts revision 2
  await syncSettle(PAST_DEBOUNCE);

  assert.equal(ctx.state.syncRev, 2, "the device remembers what it is based on");
  assert.ok(!("syncRev" in h.remoteState()),
    "but it must not ride along in the payload, or every adopt would look like a fresh edit");
  const pushesAfterAdopt = h.calls.filter((c) => c === "push").length;
  assert.equal(pushesAfterAdopt, 0, "an adopt that changed nothing shouldn't bounce a write back");
});

test("a cloud document written before revisions existed still reconciles by timestamp", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });   // no rev field at all
  const { ctx } = await loadApp({
    seed: 999,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN, "the legacy path still works during the upgrade");
});

/* =====================================================================
   HISTORY RECONCILE, PART 2: SAME-DAY "WORKED ON IT" REPEATS

   The first pass only collapsed duplicate completed *tasks*. The repeats
   actually showing up in History were workLog entries: "beat mafia 1
   definitive edition · worked on it · today" twice over, once at 7:38 AM
   and once at 5:29 PM. Both render as "today", which reads as a glitch.

   Crossing a task off with Worked on it holds it out of the scan for
   settings.workedHours (8 by default) and then lets it back in, so a
   second session later the same day is working exactly as designed —
   there is no mechanism bug here, only a log that records each session
   as its own row. One row per task per day is what History wants.

   Across days the repeats are real and stay: working on something Sunday
   AND Monday is two days of work, not a duplicate. Evergreen completions
   are exempt entirely, repeating daily being their whole point.
   ===================================================================== */

const workedLog = (ctx) =>
  Array.from(ctx.state.workLog.filter((e) => e.kind === "worked"), (e) => e.title + "@" + e.at);

// 8/31 7:38 AM and 5:29 PM local, the pair from the report.
const MORNING = new Date(2026, 7, 31, 7, 38).getTime();
const EVENING = new Date(2026, 7, 31, 17, 29).getTime();
const DAY_BEFORE = new Date(2026, 7, 30, 11, 2).getTime();

function seedWorkLog(ctx, entries) {
  ctx.state.workLog = entries.map((e, i) => ({ id: "w" + i, taskId: e.taskId || "t1", title: e.title, kind: e.kind || "worked", at: e.at }));
}

test("REGRESSION: two 'worked on it' entries for the same task on the same day collapse to one", async () => {
  const { ctx } = await loadApp({ seed: 1001 });
  seedWorkLog(ctx, [
    { title: "beat mafia 1 definitive edition", at: MORNING },
    { title: "beat mafia 1 definitive edition", at: EVENING },
  ]);

  ctx.reconcileHistory();

  assert.deepEqual(workedLog(ctx), ["beat mafia 1 definitive edition@" + EVENING],
    "one row for the day, stamped with the most recent session");
});

test("worked entries on different days are real repeats and both stay", async () => {
  const { ctx } = await loadApp({ seed: 1002 });
  seedWorkLog(ctx, [
    { title: "beat mafia 1 definitive edition", at: DAY_BEFORE },
    { title: "beat mafia 1 definitive edition", at: MORNING },
    { title: "beat mafia 1 definitive edition", at: EVENING },
  ]);

  ctx.reconcileHistory();

  assert.deepEqual(workedLog(ctx), [
    "beat mafia 1 definitive edition@" + DAY_BEFORE,
    "beat mafia 1 definitive edition@" + EVENING,
  ], "Sunday's session and Monday's session are two days of work");
});

test("evergreen completions repeat freely, same day included", async () => {
  const { ctx } = await loadApp({ seed: 1003 });
  seedWorkLog(ctx, [
    { title: "put on work clothes", kind: "evergreen-done", at: MORNING },
    { title: "put on work clothes", kind: "evergreen-done", at: EVENING },
  ]);

  ctx.reconcileHistory();

  assert.equal(ctx.state.workLog.length, 2, "recurring daily is the whole point of evergreen");
});

test("different tasks worked the same day are not each other's duplicates", async () => {
  const { ctx } = await loadApp({ seed: 1004 });
  seedWorkLog(ctx, [
    { taskId: "a", title: "beat mafia 1 definitive edition", at: MORNING },
    { taskId: "b", title: "beat star wars zero company", at: MORNING + 1000 },
    { taskId: "c", title: "play marvel gotg game", at: MORNING + 2000 },
  ]);

  ctx.reconcileHistory();

  assert.equal(ctx.state.workLog.length, 3);
});

test("a same-day repeat is caught by the regular sweep, not only when asked", async () => {
  const { ctx } = await loadApp({ seed: 1005 });
  seedWorkLog(ctx, [
    { title: "beat star wars zero company", at: MORNING },
    { title: "beat star wars zero company", at: EVENING },
  ]);

  ctx.ensureCandidate();

  assert.equal(ctx.state.workLog.length, 1, "the same pass that expires can't/worked marks catches it");
});

test("collapsing worked entries leaves the rest of the log in order", async () => {
  const { ctx } = await loadApp({ seed: 1006 });
  seedWorkLog(ctx, [
    { taskId: "a", title: "recycle magicband", at: MORNING - 3000 },
    { taskId: "b", title: "beat mafia 1", at: MORNING },
    { taskId: "a", title: "recycle magicband", at: EVENING - 1000 },
    { taskId: "b", title: "beat mafia 1", at: EVENING },
  ]);

  ctx.reconcileHistory();

  assert.deepEqual(Array.from(ctx.state.workLog, (e) => e.title),
    ["recycle magicband", "beat mafia 1"], "each survivor keeps its slot; the log stays chronological");
  assert.deepEqual(Array.from(ctx.state.workLog, (e) => e.at), [EVENING - 1000, EVENING]);
});

test("the reported log reconciles to one row per task per day", async () => {
  const { ctx } = await loadApp({ seed: 1007 });
  // The three same-day pairs from the export, plus the cross-day ones that must survive.
  seedWorkLog(ctx, [
    { taskId: "cook", title: "finish cook serve forever",   at: new Date(2026, 7, 26, 20, 22).getTime() },
    { taskId: "band", title: "recycle magicband",           at: new Date(2026, 7, 30,  6, 44).getTime() },
    { taskId: "cook", title: "finish cook serve forever",   at: new Date(2026, 7, 30,  6, 49).getTime() },
    { taskId: "mafia", title: "beat mafia 1",               at: new Date(2026, 7, 30, 11,  2).getTime() },
    { taskId: "band", title: "recycle magicband",           at: new Date(2026, 7, 30, 15, 57).getTime() },
    { taskId: "sw",   title: "beat star wars zero company", at: new Date(2026, 7, 31,  6, 38).getTime() },
    { taskId: "mafia", title: "beat mafia 1",               at: new Date(2026, 7, 31,  7, 38).getTime() },
    { taskId: "sw",   title: "beat star wars zero company", at: new Date(2026, 7, 31, 17, 28).getTime() },
    { taskId: "mafia", title: "beat mafia 1",               at: new Date(2026, 7, 31, 17, 29).getTime() },
  ]);

  ctx.reconcileHistory();

  const rows = Array.from(ctx.state.workLog, (e) => e.title + " " + new Date(e.at).getDate());
  assert.deepEqual(rows, [
    "finish cook serve forever 26",
    "recycle magicband 30",
    "finish cook serve forever 30",
    "beat mafia 1 30",
    "beat star wars zero company 31",
    "beat mafia 1 31",
  ], "the three same-day pairs collapse; every cross-day repeat survives");
});

test("HTML: 'Add a task' section comes before 'All tasks' list", () => {
  const addPanelIndex = html.indexOf('id="addPanel"');
  const listWrapIndex = html.indexOf('id="listWrap"');
  assert.ok(addPanelIndex !== -1, "addPanel element exists in HTML");
  assert.ok(listWrapIndex !== -1, "listWrap element exists in HTML");
  assert.ok(addPanelIndex < listWrapIndex, "addPanel appears before listWrap in HTML source");
});

test("CSS: '.listwrap' carries the same margin-top as its '.addwrap'/'.histwrap' siblings", () => {
  // listWrap used to be the first panel after #scan, which already supplied
  // the gap via its own margin-bottom — so .listwrap never needed a
  // margin-top of its own. Now that addPanel sits between #scan and
  // listWrap, listWrap needs the same spacing rule its stacked siblings use,
  // or the add panel and the list below it butt up with no gap.
  const m = html.match(/\.listwrap\{([^}]*)\}/);
  assert.ok(m, ".listwrap rule exists");
  assert.match(m[1], /margin-top:\s*14px/, ".listwrap has margin-top:14px, matching .addwrap/.histwrap");
});
