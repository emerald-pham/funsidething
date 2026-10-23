#!/usr/bin/env node
// One diagnostic push, immutable public sources, three bounded consumers. Never
// a scanner/release qualification. The command port is the external-process seam.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sources = Object.freeze([
  Object.freeze({ label: 'H', commit: 'db5a30c3a9a545365465a11878c1760b4dd3abc9', tree: '257035201f2b7ae5b569122875b802fa6343a7c3', tests: '697aec67fa6421ed18f3aaa916f61ba2fb73c6a68c6127f84e8b5aecd4959484' }),
  Object.freeze({ label: 'J', commit: '94300cf1b3ca85f00ed4f3c4c8954ac51b460f80', tree: '79b170dffea182f3a2c9883a0a3fd33f582a53bc', tests: '835698e543c5e324ec091b3d5799c84fd3e45d568e78f0db8bb378690e1edddb' }),
]);
export const noAck = 'RISK corrupt cloud work budget: cold-opened sources without an ACK keep newer edits without repeated downloads';
export const threeYes = 'RISK populated task responsiveness: three rapid Yes actions retain history and reopen within the interaction budget';
const productHash = '55998d5ddeec6835f46b14026bdceb7214da33cab1f2041b6c322079168a3d30';
const lockHash = '5a99c92325a167b588c22d49dae4b645e1192bf10ca99ad833023f4ed30d844b';
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const limits = Object.freeze({ outputBytes: 8 * 1024 * 1024, artifactBytes: 128 * 1024 * 1024, overallMs: 600000, commandMs: 60000, installMs: 300000, consumerMs: 90000 });
const stopReasons = new Set(['overall-deadline', 'runtime-failed', 'unsupported-runtime', 'artifact-limit', 'artifact-symlink', 'artifact-not-file', 'unexpected-profile-name', 'incomplete-profile', 'clone-failed', 'install-failed', ...sources.flatMap(source => ['checkout-', 'commit-', 'tree-', 'clean-'].map(stage => stage + source.label + '-failed').concat('immutable-source-mismatch-' + source.label)), ...['H', 'J'].flatMap(label => ['other-failure', 'incomplete-or-unexpected'].map(reason => label + '-pair-stopped-' + reason))]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// No shell, inherited credentials or arbitrary environment relay. Each command
// owns a process group; record-run forwards termination to its test group.
export async function execute(command, args, { cwd, env, timeout = limits.commandMs }) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, reason = null, error = null, escalation;
    const signal = name => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name); } catch {} };
    const stop = cause => {
      if (reason) return;
      reason = cause; signal('SIGTERM');
      escalation = setTimeout(() => signal('SIGKILL'), 2000);
    };
    const timer = setTimeout(() => stop('timeout'), timeout);
    const interrupt = () => stop('interrupted');
    process.once('SIGTERM', interrupt); process.once('SIGINT', interrupt);
    const collect = target => chunk => {
      bytes += chunk.length;
      if (bytes > limits.outputBytes) { stop('output-limit'); return; }
      if (target === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.once('error', caught => { error = caught.code ?? 'launch-error'; });
    child.once('close', (code, childSignal) => {
      if (reason) signal('SIGKILL'); // Also stop surviving members of this group.
      clearTimeout(timer); clearTimeout(escalation);
      process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt);
      resolve({ code, signal: childSignal, pid: child.pid ?? null, reason, error, stdout, stderr, bytes, complete: !reason && !error && !childSignal });
    });
  });
}

// Refuse cleanup if ownership changed, including an internal link to foreign
// data. Evidence lives elsewhere and is finalized before this is called.
export async function cleanupScratch(root, token, parent) {
  if (!root) return { status: 'not-created' };
  try {
    if (await fs.realpath(root) !== root || await fs.realpath(path.dirname(root)) !== parent || !path.basename(root).startsWith('linux-diagnostic-187-')) throw Error('root-boundary');
    if ((await fs.lstat(root)).isSymbolicLink() || !(await fs.lstat(path.join(root, '.owner'))).isFile() || await fs.readFile(path.join(root, '.owner'), 'utf8') !== token) throw Error('owner-marker');
    const check = async directory => {
      for (const name of await fs.readdir(directory)) {
        const file = path.join(directory, name), stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) {
          const real = await fs.realpath(file);
          if (!real.startsWith(root + path.sep)) throw Error('foreign-symlink');
        } else if (stat.isDirectory()) await check(file);
      }
    };
    await check(root);
    await fs.rm(root, { recursive: true });
    return { status: 'removed', root };
  } catch { return { status: 'refused', root, reason: 'ownership-or-containment-check' }; }
}

export function classifyRecord(record, source, name, result) {
  const output = record?.execution?.output?.stdout ?? '';
  const lines = output.split('\n');
  const outcomes = lines.filter(line => /^(?:not )?ok \d+ - /.test(line));
  const exact = outcomes.length === 1 && new RegExp('^(?:not )?ok 1 - ' + escapeRegex(name) + '$').test(outcomes[0]);
  const metric = (key, value) => lines.filter(line => new RegExp('^# ' + key + ' \\d+$').test(line)).join('\n') === '# ' + key + ' ' + value;
  const count = key => metric(key, 1), zero = key => metric(key, 0);
  const plan = lines.filter(line => /^1\.\.\d+$/.test(line)).join('\n') === '1..1';
  const subtest = lines.filter(line => line.startsWith('# Subtest: ')).join('\n') === '# Subtest: ' + name;
  if (!result.complete || record?.state !== 'complete' || record.execution.signal || record.execution.wrapperExitCode !== result.code || record.git?.commit !== source.commit || record.workingTree?.identity?.status !== 'complete' || record.workingTree.sourceTestFiles.length !== 0 || !exact || !plan || !subtest || !count('tests') || !zero('cancelled') || !zero('skipped') || !zero('todo')) return 'incomplete-or-unexpected';
  if (result.code === 0 && record.execution.exitCode === 0 && count('pass') && zero('fail') && outcomes[0].startsWith('ok ')) return 'passed';
  const location = source.label === 'H' ? ['3303:32', '3304:124'] : ['3303:36', '3315:124'];
  const settleFrame = new RegExp('^\\s+settle \\(file://[^\\n]+/tests\\.js:' + escapeRegex(location[0]) + '\\)$', 'm');
  const firstAddFrame = new RegExp('^\\s+async file://[^\\n]+/tests\\.js:' + escapeRegex(location[1]) + '$', 'm');
  // Immutable source + these two stack frames distinguish the very first Add
  // settle from later settles on the same assertion. No generic assertion pass.
  if (name === noAck && result.code === 1 && record.execution.exitCode === 1 && zero('pass') && count('fail') && outcomes[0].startsWith('not ok ') && /code: 'ERR_ASSERTION'/.test(output) && /operator: 'strictEqual'/.test(output) && /actual: false/.test(output) && /expected: true/.test(output) && settleFrame.test(output) && firstAddFrame.test(output)) return 'original-first-add-refusal';
  if (result.code === 1 && record.execution.exitCode === 1 && zero('pass') && count('fail')) return 'other-failure';
  return 'incomplete-or-unexpected';
}

async function inventory(directory, omitOversize = false) {
  const entries = [], omitted = []; let bytes = 0;
  const walk = async root => {
    for (const name of (await fs.readdir(root)).sort()) {
      const file = path.join(root, name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) {
        if (!omitOversize) throw Error('artifact-symlink');
        omitted.push({ path: path.relative(directory, file), reason: 'symlink-not-followed' });
        await fs.unlink(file); continue;
      }
      if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) {
        if (bytes + stat.size > limits.artifactBytes - 1024 * 1024 || entries.length >= 500) {
          if (!omitOversize) throw Error('artifact-limit');
          omitted.push({ path: path.relative(directory, file), bytes: stat.size, reason: 'whole-file-omitted-over-artifact-envelope' });
          await fs.unlink(file); continue;
        }
        bytes += stat.size;
        entries.push({ path: path.relative(directory, file), bytes: stat.size, sha256: digest(await fs.readFile(file)) });
      } else throw Error('artifact-not-file');
    }
  };
  await walk(directory); return { bytes, entries, omitted };
}

// executePort runs actual Git and recorder commands in production. Process
// tests replace only this boundary with real recording child executables.
export async function runDiagnostic({ repo, evidenceDir, scratchParent }, executePort = execute) {
  repo = await fs.realpath(repo); scratchParent = await fs.realpath(scratchParent);
  evidenceDir = path.join(await fs.realpath(path.dirname(path.resolve(evidenceDir))), path.basename(evidenceDir));
  if (evidenceDir === repo || evidenceDir.startsWith(repo + path.sep)) throw Error('evidence-must-be-external');
  await fs.mkdir(evidenceDir, { mode: 0o700 }); // Never overwrite an earlier run.
  const summary = { schemaVersion: 1, diagnosticOnly: true, startedAt: new Date().toISOString(), limits, sources: [], consumers: [], status: 'incomplete', cleanup: null, limitsOfEvidence: ['Not scanner qualification or a repair.', 'One ordered pair is not causal isolation.', 'CPU sampling perturbs timing and covers the whole case; phase claims require actual call ancestry.'] };
  let scratch, token, sequence = 0;
  const deadline = performance.now() + limits.overallMs;
  let env = { PATH: process.env.PATH, TZ: 'UTC', LANG: 'C.UTF-8' };
  const command = async (stage, executable, args, cwd, timeout) => {
    // Reserve the complete outer command allowance before launch; never shrink
    // a consumer's original 20s/30s contract to fit a nearly expired job.
    if (deadline - performance.now() < timeout) throw Error('overall-deadline');
    const result = await executePort(executable, args, { cwd, env, timeout });
    await json(path.join(evidenceDir, String(++sequence).padStart(2, '0') + '-' + stage + '.json'), { stage, executable, args, cwd, result });
    return result;
  };
  const required = async (...args) => {
    const result = await command(...args);
    if (!result.complete || result.code !== 0) throw Error(args[0] + '-failed');
    return result.stdout.trim();
  };
  try {
    const runtimeScript = "const os=require('node:os'),v8=require('node:v8');console.log(JSON.stringify({platform:process.platform,arch:process.arch,version:process.version,executable:process.execPath,kernel:os.release(),cpus:os.availableParallelism(),memory:os.totalmem(),heap:v8.getHeapStatistics().heap_size_limit,imageOS:process.env.ImageOS??null,imageVersion:process.env.ImageVersion??null}))";
    const runtimeResult = await command('runtime', process.execPath, ['-e', runtimeScript], repo, limits.commandMs);
    if (!runtimeResult.complete || runtimeResult.code !== 0) throw Error('runtime-failed');
    summary.runtime = JSON.parse(runtimeResult.stdout);
    // Image identifiers are the only additional inherited metadata, read by the
    // parent explicitly rather than relaying credentials or a whole environment.
    summary.runtime.imageOS = process.env.ImageOS ?? null;
    summary.runtime.imageVersion = process.env.ImageVersion ?? null;
    if (summary.runtime.platform !== 'linux' || summary.runtime.arch !== 'x64' || summary.runtime.version !== 'v22.23.3') throw Error('unsupported-runtime');
    scratch = await fs.mkdtemp(path.join(scratchParent, 'linux-diagnostic-187-'));
    scratch = await fs.realpath(scratch); token = randomUUID();
    await fs.writeFile(path.join(scratch, '.owner'), token, { flag: 'wx' });
    const home = path.join(scratch, 'home'); await fs.mkdir(home);
    const npmConfig = path.join(home, 'empty-npmrc'); await fs.writeFile(npmConfig, '');
    env = { ...env, HOME: home, npm_config_userconfig: npmConfig, npm_config_cache: path.join(home, 'npm-cache'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    const clone = path.join(scratch, 'repository');
    await required('clone', 'git', ['clone', '--shared', '--no-checkout', '--no-hardlinks', repo, clone], repo, limits.commandMs);
    // The owned dependency link is not covered by the source's directory-only
    // node_modules/ ignore. Exclude that one path in our disposable Git store;
    // source files and the immutable tracked tree remain unchanged.
    await fs.appendFile(path.join(clone, '.git/info/exclude'), '\n/node_modules\n');
    for (const source of sources) {
      const checkout = path.join(scratch, source.label);
      await required('checkout-' + source.label, 'git', ['-C', clone, 'worktree', 'add', '--detach', checkout, source.commit], repo, limits.commandMs);
      const commit = await required('commit-' + source.label, 'git', ['rev-parse', 'HEAD'], checkout, limits.commandMs);
      const tree = await required('tree-' + source.label, 'git', ['rev-parse', 'HEAD^{tree}'], checkout, limits.commandMs);
      const status = await required('clean-' + source.label, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], checkout, limits.commandMs);
      if (commit !== source.commit || tree !== source.tree || status) {
        summary.sources.push({ ...source, checkout, actual: { commit, tree, status } });
        throw Error('immutable-source-mismatch-' + source.label);
      }
      const hashes = Object.fromEntries(await Promise.all(['tests.js', 'index.html', 'package-lock.json'].map(async name => [name, digest(await fs.readFile(path.join(checkout, name)))])));
      summary.sources.push({ ...source, checkout, actual: { commit, tree, status, hashes } });
      if (hashes['tests.js'] !== source.tests || hashes['index.html'] !== productHash || hashes['package-lock.json'] !== lockHash) throw Error('immutable-source-mismatch-' + source.label);
    }
    const h = path.join(scratch, 'H'), j = path.join(scratch, 'J');
    await required('install', 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], j, limits.installMs);
    await fs.symlink(path.join(j, 'node_modules'), path.join(h, 'node_modules'), 'dir');
    const consume = async (source, name, label, profile = false) => {
      const checkout = path.join(scratch, source.label), out = path.join(evidenceDir, label);
      await fs.mkdir(out);
      const records = path.join(out, 'records');
      const args = [];
      if (profile) {
        const profiles = path.join(out, 'profiles'); await fs.mkdir(profiles);
        args.push('--cpu-prof', '--cpu-prof-dir=' + profiles);
      }
      args.push('--test', '--test-reporter=tap', '--test-name-pattern=^' + escapeRegex(name) + '$', 'tests.js');
      const result = await command(label, process.execPath, [path.join(moduleRoot, 'scripts/agent-tools/record-run.mjs'), '--repo', checkout, '--evidence-dir', records, '--purpose', 'later-baseline-sensitivity', '--', process.execPath, ...args], checkout, limits.consumerMs);
      const files = (await fs.readdir(records).catch(() => [])).filter(file => file.endsWith('.json'));
      if (files.length === 1 && !(await fs.lstat(path.join(records, files[0]))).isFile()) throw Error('artifact-not-file');
      const record = files.length === 1 ? JSON.parse(await fs.readFile(path.join(records, files[0]), 'utf8')) : null;
      const classification = classifyRecord(record, source, name, result);
      const item = { source: source.label, name, label, profiled: profile, classification, processPid: result.pid, record: files.length === 1 ? path.relative(evidenceDir, path.join(records, files[0])) : null, complete: result.complete };
      if (profile) {
        item.profiles = [];
        for (const file of (await fs.readdir(path.join(out, 'profiles'))).sort()) {
          if (!/^CPU\..*\.\d+\.\d+\.\d+\.cpuprofile$/.test(file)) throw Error('unexpected-profile-name');
          const profilePath = path.join(out, 'profiles', file);
          const profileStat = await fs.lstat(profilePath);
          if (!profileStat.isFile()) throw Error('artifact-not-file');
          if (profileStat.size > limits.artifactBytes) throw Error('artifact-limit');
          const bytes = await fs.readFile(profilePath);
          const data = JSON.parse(bytes);
          if (!Array.isArray(data.nodes) || !Array.isArray(data.samples) || !Array.isArray(data.timeDeltas) || data.samples.length !== data.timeDeltas.length) throw Error('incomplete-profile');
          const byId = new Map(data.nodes.map(node => [node.id, node])), parents = new Map();
          for (const node of data.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
          const ancestrySamples = { onAction: 0, decide: 0, perform: 0 };
          for (const id of data.samples) {
            const seen = new Set(), names = new Set(); let cursor = id;
            while (byId.has(cursor) && !seen.has(cursor)) { seen.add(cursor); names.add(byId.get(cursor).callFrame?.functionName); cursor = parents.get(cursor); }
            for (const name of Object.keys(ancestrySamples)) if (names.has(name)) ancestrySamples[name]++;
          }
          item.profiles.push({ file, sha256: digest(bytes), bytes: bytes.length, pid: Number(file.split('.').at(-4)), samples: data.samples.length, startTime: data.startTime, endTime: data.endTime, hasTestsJsFrame: data.nodes.some(node => node.callFrame?.url?.endsWith('/tests.js')), ancestrySamples });
        }
        item.profileScope = 'PID filenames retained; recorder PID is known. Test child PID is inferred only where profile call frames identify tests.js; no phase attribution is automatic.';
        item.testChildProfilePids = item.profiles.filter(entry => entry.hasTestsJsFrame).map(entry => entry.pid);
        if (!item.profiles.length) item.classification = 'incomplete-or-unexpected';
      }
      summary.consumers.push(item);
      await json(path.join(out, 'verdict.json'), item);
      // Fail closed before advancing if artifacts exceed the complete envelope.
      await inventory(evidenceDir);
      return item.classification;
    };
    const hResult = await consume(sources[0], noAck, 'H-noACK');
    if (!['passed', 'original-first-add-refusal'].includes(hResult)) throw Error('H-pair-stopped-' + hResult);
    const jResult = await consume(sources[1], noAck, 'J-noACK');
    if (!['passed', 'original-first-add-refusal'].includes(jResult)) throw Error('J-pair-stopped-' + jResult);
    const profileResult = await consume(sources[1], threeYes, 'J-threeYes-profile', true);
    summary.status = profileResult === 'passed' ? 'completed' : 'completed-with-negative-or-incomplete-profile';
    summary.exitCode = summary.consumers.every(item => item.classification === 'passed') ? 0 : 1;
  } catch (error) {
    // Only finite internal stage/reason strings are emitted, never environment,
    // arbitrary exception messages, private sources or credentials.
    summary.stopReason = stopReasons.has(error.message) ? error.message : 'setup-or-artifact-failure';
    summary.exitCode = 1;
  }
  summary.finishedAt = new Date().toISOString();
  // An oversized result is explicitly incomplete. Omit whole carrier-created
  // files, recording their names/sizes (no false complete digest), so the
  // always-upload envelope stays bounded rather than silently truncating data.
  const bounded = await inventory(evidenceDir, true);
  if (bounded.omitted.length) { summary.artifactOmissions = bounded.omitted; summary.status = 'incomplete'; summary.exitCode = 1; }
  // Persist source/outcome evidence before removing any owned scratch.
  await json(path.join(evidenceDir, 'before-cleanup.json'), summary);
  summary.cleanup = await cleanupScratch(scratch, token, scratchParent);
  if (summary.cleanup.status === 'refused') summary.exitCode = 1;
  await json(path.join(evidenceDir, 'summary.json'), summary);
  try { await json(path.join(evidenceDir, 'manifest.json'), await inventory(evidenceDir)); }
  catch { await json(path.join(evidenceDir, 'artifact-incomplete.json'), { complete: false, reason: 'artifact-limit-or-invalid-file' }); summary.exitCode = 1; }
  return summary;
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--repo', '--evidence-dir', '--scratch-parent'].includes(argv[i]) || !argv[i + 1] || options[argv[i]]) throw Error('Expected unique --repo, --evidence-dir, --scratch-parent paths only.');
    options[argv[i]] = argv[i + 1];
  }
  if (Object.keys(options).length !== 3) throw Error('Expected --repo, --evidence-dir, --scratch-parent.');
  const summary = await runDiagnostic({ repo: options['--repo'], evidenceDir: options['--evidence-dir'], scratchParent: options['--scratch-parent'] });
  console.log(JSON.stringify({ status: summary.status, stopReason: summary.stopReason ?? null, consumers: summary.consumers, cleanup: summary.cleanup }));
  process.exitCode = summary.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(() => { console.error('linux-diagnostic-187: invalid paths/options or evidence finalization failed'); process.exitCode = 2; });
