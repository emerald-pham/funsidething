#!/usr/bin/env node

import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { open, link, mkdir, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

const MAX_RECORD_BYTES = 32 * 1024;
const MAX_POINTER_BYTES = 2 * 1024 * 1024;
const MAX_POINTER_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_POINTERS = 32;
const MAX_GATES = 32;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const READ_ONLY = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object.`);
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    fail(`${field} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function text(value, field, max = 300) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max) {
    fail(`${field} must be a trimmed string of 1 to ${max} characters.`);
  }
  return value;
}

function recordId(value, field) {
  const result = text(value, field, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(result)) fail(`${field} has an invalid identifier.`);
  return result;
}

function exactSha(value, field) {
  if (typeof value !== 'string' || !SHA1.test(value)) fail(`${field} must be a full lowercase 40-character Git SHA.`);
  return value;
}

function git(repo, args, label) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0) {
    fail(`Could not inspect ${label}: ${result.error?.message || result.stderr?.trim() || result.signal || `Git exited ${result.status}`}.`);
  }
  return result.stdout.trim();
}

function exactCommit(repo, sha, field) {
  exactSha(sha, field);
  if (git(repo, ['rev-parse', '--verify', `${sha}^{commit}`], field) !== sha) fail(`${field} must name the exact commit object.`);
  return sha;
}

function sourceTree(repo, commit, field) {
  const tree = git(repo, ['rev-parse', '--verify', `${commit}^{tree}`], `${field} tree`);
  if (!SHA1.test(tree)) fail(`${field} did not resolve to a full Git tree SHA.`);
  return tree;
}

async function readBounded(filePath, maximum, field) {
  const handle = await open(filePath, READ_ONLY);
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail(`${field} must be a regular file.`);
    if (before.size > maximum) fail(`${field} exceeds the ${maximum}-byte limit.`);
    const chunks = [];
    const buffer = Buffer.alloc(16 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximum) fail(`${field} exceeds the ${maximum}-byte limit.`);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      fail(`${field} changed while it was being read.`);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function readJson(filePath, field) {
  let bytes;
  try {
    bytes = await readBounded(filePath, MAX_RECORD_BYTES, field);
  } catch (error) {
    if (error?.code === 'ELOOP') fail(`${field} must not be a symbolic link.`);
    throw error;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(`${field} must contain valid UTF-8 JSON.`);
  }
}

async function sha256File(filePath, aggregate) {
  let handle;
  try {
    handle = await open(filePath, READ_ONLY);
    const before = await handle.stat();
    if (!before.isFile()) fail(`Evidence pointer ${filePath} must name a regular file.`);
    if (before.size > MAX_POINTER_BYTES) fail(`Evidence pointer ${filePath} exceeds the ${MAX_POINTER_BYTES}-byte limit.`);
    aggregate.bytes += before.size;
    if (aggregate.bytes > MAX_POINTER_TOTAL_BYTES) fail(`Evidence pointers exceed the ${MAX_POINTER_TOTAL_BYTES}-byte total limit.`);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_POINTER_BYTES) fail(`Evidence pointer ${filePath} exceeds the ${MAX_POINTER_BYTES}-byte limit.`);
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || total !== before.size) {
      fail(`Evidence pointer ${filePath} changed while it was being read.`);
    }
    return hash.digest('hex');
  } catch (error) {
    if (error?.code === 'ELOOP') fail(`Evidence pointer ${filePath} must not be a symbolic link.`);
    if (error?.code === 'ENOENT' || error?.code === 'EACCES') fail(`Evidence pointer ${filePath} is unavailable.`);
    throw error;
  } finally {
    await handle?.close();
  }
}

function collectPointers(record) {
  return [
    ...record.requiredGates.flatMap((gate) => gate.evidence),
    ...record.followUps.flatMap((followUp) => followUp.evidence),
  ];
}

async function validateRecord(repo, record) {
  exactKeys(record, ['schemaVersion', 'id', 'revision', 'source', 'status', 'requiredGates', 'followUps', 'nextAction'], 'checkpoint');
  if (record.schemaVersion !== 1) fail('checkpoint.schemaVersion must be 1.');
  recordId(record.id, 'checkpoint.id');
  if (!Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision > 1000000) fail('checkpoint.revision must be an integer from 1 to 1000000.');

  exactKeys(record.source, ['commit', 'tree', 'base'], 'checkpoint.source');
  const commit = exactCommit(repo, record.source.commit, 'checkpoint.source.commit');
  const tree = exactSha(record.source.tree, 'checkpoint.source.tree');
  if (sourceTree(repo, commit, 'checkpoint.source.commit') !== tree) fail('checkpoint source tree does not match its exact commit.');
  const base = exactCommit(repo, record.source.base, 'checkpoint.source.base');
  const ancestry = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', base, commit], { encoding: 'utf8' });
  if (ancestry.error || ancestry.signal || ancestry.status !== 0) fail('checkpoint source base must be an existing ancestor of the exact source commit.');

  if (!Array.isArray(record.requiredGates) || record.requiredGates.length < 1 || record.requiredGates.length > MAX_GATES) {
    fail(`checkpoint.requiredGates must contain 1 to ${MAX_GATES} gates.`);
  }
  if (!Array.isArray(record.followUps) || record.followUps.length > MAX_GATES) fail(`checkpoint.followUps must contain at most ${MAX_GATES} items.`);
  const ids = new Set();
  for (const [index, gate] of record.requiredGates.entries()) {
    const field = `checkpoint.requiredGates[${index}]`;
    exactKeys(gate, ['id', 'status', 'summary', 'evidence'], field);
    const id = recordId(gate.id, `${field}.id`);
    if (ids.has(id)) fail(`checkpoint item id ${id} is duplicated.`);
    ids.add(id);
    if (!['pending', 'failed', 'cancelled', 'unresolved', 'passed'].includes(gate.status)) fail(`${field}.status is invalid.`);
    text(gate.summary, `${field}.summary`);
    if (!Array.isArray(gate.evidence)) fail(`${field}.evidence must be an array.`);
  }
  for (const [index, followUp] of record.followUps.entries()) {
    const field = `checkpoint.followUps[${index}]`;
    exactKeys(followUp, ['id', 'status', 'summary', 'evidence'], field);
    const id = recordId(followUp.id, `${field}.id`);
    if (ids.has(id)) fail(`checkpoint item id ${id} is duplicated.`);
    ids.add(id);
    if (!['unverified', 'in_progress', 'complete'].includes(followUp.status)) fail(`${field}.status is invalid.`);
    text(followUp.summary, `${field}.summary`);
    if (!Array.isArray(followUp.evidence)) fail(`${field}.evidence must be an array.`);
  }

  const pointers = collectPointers(record);
  if (pointers.length > MAX_POINTERS) fail(`checkpoint may contain at most ${MAX_POINTERS} evidence pointers.`);
  const pointerIds = new Set();
  const aggregate = { bytes: 0 };
  const pointerCurrent = new Map();
  for (const [index, pointer] of pointers.entries()) {
    const field = `checkpoint evidence[${index}]`;
    exactKeys(pointer, ['id', 'path', 'sha256', 'sourceCommit', 'sourceTree'], field);
    const id = recordId(pointer.id, `${field}.id`);
    if (pointerIds.has(id)) fail(`checkpoint evidence id ${id} is duplicated.`);
    pointerIds.add(id);
    const evidencePath = text(pointer.path, `${field}.path`, 2000);
    if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(evidencePath)) fail(`${field}.path must be an absolute artifact path.`);
    if (typeof pointer.sha256 !== 'string' || !SHA256.test(pointer.sha256)) fail(`${field}.sha256 must be a full lowercase SHA-256 digest.`);
    const evidenceCommit = exactCommit(repo, pointer.sourceCommit, `${field}.sourceCommit`);
    const evidenceTree = exactSha(pointer.sourceTree, `${field}.sourceTree`);
    if (sourceTree(repo, evidenceCommit, `${field}.sourceCommit`) !== evidenceTree) fail(`${field}.sourceTree does not match its exact evidence commit.`);
    const actualDigest = await sha256File(evidencePath, aggregate);
    if (actualDigest !== pointer.sha256) fail(`${field} SHA-256 does not match the immutable artifact bytes.`);
    pointerCurrent.set(id, evidenceCommit === commit && evidenceTree === tree);
  }
  for (const gate of record.requiredGates) {
    if (gate.status === 'passed' && !gate.evidence.some((pointer) => pointerCurrent.get(pointer.id))) {
      fail(`Required gate ${gate.id} is passed without evidence for the current source commit and tree.`);
    }
  }

  const incomplete = record.requiredGates.filter((gate) => gate.status !== 'passed');
  if (!['open', 'complete'].includes(record.status)) fail('checkpoint.status must be open or complete.');
  if ((record.status === 'complete') !== (incomplete.length === 0)) fail('checkpoint.status does not match required-gate completion.');
  if (record.status === 'complete') {
    if (record.nextAction !== null) fail('A complete checkpoint must have nextAction: null.');
  } else {
    exactKeys(record.nextAction, ['gateId', 'summary'], 'checkpoint.nextAction');
    if (typeof record.nextAction.gateId !== 'string' || !incomplete.some((gate) => gate.id === record.nextAction.gateId)) {
      fail('An open checkpoint nextAction must name one incomplete required gate.');
    }
    text(record.nextAction.summary, 'checkpoint.nextAction.summary');
  }
  return record;
}

async function atomicCreate(outputPath, record) {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  if (bytes.length > MAX_RECORD_BYTES) fail(`serialized checkpoint exceeds the ${MAX_RECORD_BYTES}-byte limit.`);
  const target = resolve(outputPath);
  const directory = dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = resolve(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertItemHistoryPreserved(previousItems, nextItems, kind) {
  const nextById = new Map(nextItems.map((item) => [item.id, item]));
  for (const previous of previousItems) {
    const next = nextById.get(previous.id);
    if (!next) fail(`resume cannot remove ${kind} ${previous.id}.`);
    const nextEvidence = new Map(next.evidence.map((pointer) => [pointer.id, pointer]));
    for (const pointer of previous.evidence) {
      const replacement = nextEvidence.get(pointer.id);
      if (!replacement || canonical(replacement) !== canonical(pointer)) {
        fail(`resume must keep immutable evidence pointer ${pointer.id} under its original ${kind} ${previous.id}.`);
      }
    }
  }
}

function summary(record, operation, outputPath) {
  const passed = record.requiredGates.filter((gate) => gate.status === 'passed').length;
  return {
    operation,
    record: resolve(outputPath),
    id: record.id,
    revision: record.revision,
    source: record.source,
    status: record.status,
    requiredGates: { passed, total: record.requiredGates.length },
    followUps: record.followUps.map(({ id, status }) => ({ id, status })),
    nextAction: record.nextAction,
  };
}

function parseArguments(args) {
  const [operation, ...values] = args;
  const allowed = new Set(['create', 'resume', 'validate']);
  if (!allowed.has(operation)) fail('Commands: create, resume, validate.');
  const options = {};
  const accepted = operation === 'create' ? new Set(['repo', 'record', 'input'])
    : operation === 'resume' ? new Set(['repo', 'previous', 'record', 'input'])
      : new Set(['repo', 'record']);
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith('--')) fail(`Unexpected argument: ${key}.`);
    const name = key.slice(2);
    const value = values[index + 1];
    if (!accepted.has(name)) fail(`Unknown option: ${key}.`);
    if (!value || value.startsWith('--')) fail(`${key} needs a value.`);
    if (Object.hasOwn(options, name)) fail(`${key} may be provided only once.`);
    options[name] = value;
    index += 1;
  }
  const required = operation === 'create' ? ['repo', 'record', 'input']
    : operation === 'resume' ? ['repo', 'previous', 'record', 'input']
      : ['repo', 'record'];
  for (const name of required) if (!options[name]) fail(`Required option: --${name}.`);
  return { operation, options };
}

async function main() {
  if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    process.stdout.write('Usage: node scripts/agent-tools/checkpoint.mjs <create|resume|validate> --repo <git-worktree> --record <json-path> [--input <manifest.json>] [--previous <checkpoint.json>]\n');
    process.stdout.write('Checkpoint state records exact Git identity, required gates, separate follow-ups, immutable artifact pointers, and one next required action. It does not run gates.\n');
    return;
  }
  const { operation, options } = parseArguments(process.argv.slice(2));
  const repo = resolve(options.repo);
  if (operation === 'validate') {
    const record = await readJson(resolve(options.record), 'checkpoint record');
    await validateRecord(repo, record);
    process.stdout.write(`${JSON.stringify(summary(record, 'validate', options.record))}\n`);
    return;
  }
  const candidate = await readJson(resolve(options.input), 'checkpoint input');
  await validateRecord(repo, candidate);
  if (operation === 'create') {
    if (resolve(options.input) === resolve(options.record)) fail('--input and --record must be different paths.');
    await atomicCreate(options.record, candidate);
    process.stdout.write(`${JSON.stringify(summary(candidate, 'create', options.record))}\n`);
    return;
  }
  const previousPath = resolve(options.previous);
  const outputPath = resolve(options.record);
  if (previousPath === outputPath || resolve(options.input) === previousPath || resolve(options.input) === outputPath) {
    fail('--previous, --input, and --record must be different paths.');
  }
  const previous = await readJson(previousPath, 'previous checkpoint');
  await validateRecord(repo, previous);
  if (candidate.id !== previous.id) fail('resume must retain the previous checkpoint id.');
  if (candidate.revision !== previous.revision + 1) fail('resume must increment the checkpoint revision by exactly one.');
  if (canonical(candidate.source) !== canonical(previous.source)) fail('resume must retain the exact previous source commit, tree, and base.');
  assertItemHistoryPreserved(previous.requiredGates, candidate.requiredGates, 'required gate');
  assertItemHistoryPreserved(previous.followUps, candidate.followUps, 'follow-up');
  await atomicCreate(outputPath, candidate);
  process.stdout.write(`${JSON.stringify(summary(candidate, 'resume', outputPath))}\n`);
}

main().catch((error) => {
  process.stderr.write(`checkpoint: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
