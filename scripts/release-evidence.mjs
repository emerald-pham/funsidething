import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RELEASE_STATUS_CONTEXTS = Object.freeze([
  'funsidething/memory-audit',
  'funsidething/independent-review',
]);

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const receiptRootName = 'funsidething-release-evidence';

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function gitCommonDir(repoRoot) {
  const root = git(repoRoot, ['rev-parse', '--show-toplevel']);
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return { root, common };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashFile(file) {
  return sha256(fs.readFileSync(file));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function receiptDigest(receipt) {
  const { receiptSha256, ...payload } = receipt;
  return sha256(Buffer.from(canonicalJson(payload)));
}

function taskId(value, field) {
  if (typeof value !== 'string' || value.trim().length < 3) throw new Error(field + ' must name the accountable task identity.');
  return value.trim();
}

function validTime(value, field) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value || timestamp > Date.now()) {
    throw new Error(field + ' must be a current or past canonical ISO timestamp; future completion times are invalid.');
  }
  return value;
}

function memoryCloudSyncScope(scope, field = 'memoryAudit.scope') {
  const domains = ['memory', 'cloud', 'sync'];
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error(field + ' must explicitly assess memory, cloud, and sync impact.');
  }
  const assessed = {};
  for (const domain of domains) {
    const entry = scope[domain];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.affected !== 'boolean') {
      throw new Error(field + '.' + domain + ' must set an affected boolean.');
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length < 20) {
      throw new Error(field + '.' + domain + ' must record a specific impact rationale.');
    }
    if (!Array.isArray(entry.tests) || !entry.tests.every(test => typeof test === 'string' && test.trim().length >= 10)) {
      throw new Error(field + '.' + domain + '.tests must list focused test evidence or be an empty array.');
    }
    if (entry.affected && entry.tests.length === 0) {
      throw new Error(field + '.' + domain + ' is affected and needs focused test evidence.');
    }
    assessed[domain] = {
      affected: entry.affected,
      rationale: entry.rationale.trim(),
      tests: entry.tests.map(test => test.trim()),
    };
  }
  return assessed;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function candidateTree(repoRoot, commitSha) {
  if (!SHA1.test(commitSha)) throw new Error('Candidate commit SHA must contain 40 lowercase hexadecimal characters.');
  const actual = git(repoRoot, ['rev-parse', commitSha + '^{commit}']);
  if (actual !== commitSha) throw new Error('Candidate SHA must name the full commit object, not a tag or abbreviation.');
  return git(repoRoot, ['rev-parse', commitSha + '^{tree}']);
}

function assertAncestor(repoRoot, baseSha, commitSha) {
  if (!SHA1.test(baseSha)) throw new Error('Candidate base SHA must contain 40 lowercase hexadecimal characters.');
  const result = spawnSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', baseSha, commitSha], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Candidate base must be an existing ancestor of the exact candidate commit.');
}

function evidenceFile(repoRoot, sourcePath, expectedSha, label) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new Error(label + ' evidence path must be absolute and outside the repository.');
  const resolved = fs.realpathSync(sourcePath);
  if (isInside(repoRoot, resolved)) throw new Error(label + ' evidence must remain outside the committed worktree.');
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(label + ' evidence must be a regular file.');
  if (!SHA256.test(expectedSha || '') || hashFile(resolved) !== expectedSha) throw new Error(label + ' evidence SHA-256 does not match its recorded digest.');
  return fs.readFileSync(resolved);
}

function validateInput(repoRoot, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Release evidence input must be a JSON object.');
  if (input.schemaVersion !== 1) throw new Error('Release evidence input must use schemaVersion 1.');
  const commitSha = input.candidate?.commitSha;
  const treeSha = input.candidate?.treeSha;
  const baseSha = input.candidate?.baseSha;
  const actualTree = candidateTree(repoRoot, commitSha);
  if (!SHA1.test(treeSha || '') || actualTree !== treeSha) throw new Error('Candidate tree SHA does not match the exact commit.');
  assertAncestor(repoRoot, baseSha, commitSha);
  const ownerTask = taskId(input.ownerTask, 'ownerTask');
  const auditorTask = taskId(input.memoryAudit?.task, 'memoryAudit.task');
  const reviewerTask = taskId(input.independentReview?.task, 'independentReview.task');
  const identities = [ownerTask, auditorTask, reviewerTask].map(value => value.toLocaleLowerCase());
  if (new Set(identities).size !== identities.length) throw new Error('Owner, memory auditor, and independent reviewer need distinct task identities.');
  if (input.memoryAudit.outcome !== 'pass') throw new Error('Memory audit outcome must be pass.');
  const memoryScope = memoryCloudSyncScope(input.memoryAudit.scope);
  if (input.independentReview.outcome !== 'approved') throw new Error('Independent review outcome must be approved.');
  if (input.independentReview.reviewedSha !== commitSha) throw new Error('Independent review must name the exact candidate SHA.');
  const auditTime = validTime(input.memoryAudit.completedAt, 'Memory audit');
  const reviewTime = validTime(input.independentReview.completedAt, 'Independent review');
  if (typeof input.independentReview.summary !== 'string' || input.independentReview.summary.trim().length < 20) {
    throw new Error('Independent review must record a specific summary.');
  }
  const scope = input.independentReview.scope;
  if (!scope || scope.fullDiff !== true || scope.relevantTests !== true || scope.userVisibleAndDataSafety !== true) {
    throw new Error('Independent review must cover the full diff, relevant tests, and user-visible or data-safety effects.');
  }
  if (!Array.isArray(input.memoryAudit.sources) || input.memoryAudit.sources.length === 0) {
    throw new Error('Memory audit must name the source files and evidence fingerprints it checked.');
  }
  const sources = input.memoryAudit.sources.map(source => {
    if (!source || typeof source.path !== 'string' || source.path.trim().length < 3 || !SHA256.test(source.sha256 || '')) {
      throw new Error('Each memory audit source needs a path and a SHA-256 fingerprint.');
    }
    if (!path.isAbsolute(source.path)) throw new Error('Memory audit source paths must be absolute.');
    const resolved = path.resolve(source.path);
    if (!fs.statSync(resolved).isFile() || hashFile(resolved) !== source.sha256) {
      throw new Error('Memory audit source fingerprint does not match the source read at audit time: ' + source.path);
    }
    return { path: source.path, sha256: source.sha256 };
  });
  const memoryBytes = evidenceFile(repoRoot, input.memoryAudit.evidencePath, input.memoryAudit.evidenceSha256, 'Memory audit');
  const reviewBytes = evidenceFile(repoRoot, input.independentReview.evidencePath, input.independentReview.evidenceSha256, 'Independent review');
  return {
    receipt: {
      schemaVersion: 1,
      candidate: { commitSha, treeSha, baseSha },
      ownerTask,
      memoryAudit: {
        task: auditorTask,
        outcome: 'pass',
        completedAt: auditTime,
        scope: memoryScope,
        sources,
        evidence: { file: 'memory-audit.md', sha256: sha256(memoryBytes) },
      },
      independentReview: {
        task: reviewerTask,
        outcome: 'approved',
        reviewedSha: commitSha,
        completedAt: reviewTime,
        summary: input.independentReview.summary.trim(),
        scope: { fullDiff: true, relevantTests: true, userVisibleAndDataSafety: true },
        evidence: { file: 'independent-review.md', sha256: sha256(reviewBytes) },
      },
    },
    memoryBytes,
    reviewBytes,
  };
}

function receiptDirectory(repoRoot, commitSha) {
  const { common } = gitCommonDir(repoRoot);
  return path.join(common, receiptRootName, commitSha);
}

export function recordReleaseEvidence(repoRoot, input) {
  const { root } = gitCommonDir(repoRoot);
  const validated = validateInput(root, input);
  const receipt = validated.receipt;
  receipt.receiptSha256 = receiptDigest(receipt);
  const directory = receiptDirectory(root, receipt.candidate.commitSha);
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('An external receipt already exists for this candidate; receipts are immutable.');
    throw error;
  }
  try {
    fs.writeFileSync(path.join(directory, 'memory-audit.md'), validated.memoryBytes, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'independent-review.md'), validated.reviewBytes, { flag: 'wx', mode: 0o600 });
    const receiptPath = path.join(directory, 'receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const result = verifyReleaseEvidence(root, receipt.candidate.commitSha);
    if (!result.ok) throw new Error('Recorded receipt did not validate: ' + result.errors.join(' '));
    return { receiptPath, receipt };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function verifyReleaseEvidence(repoRoot, commitSha) {
  const errors = [];
  if (!SHA1.test(commitSha || '')) return { ok: false, errors: ['Candidate SHA must contain 40 lowercase hexadecimal characters.'] };
  const directory = receiptDirectory(repoRoot, commitSha);
  const receiptPath = path.join(directory, 'receipt.json');
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    return { ok: false, errors: ['Missing or malformed exact-SHA release receipt: ' + error.message], receiptPath };
  }
  if (!receipt || typeof receipt !== 'object' || receipt.schemaVersion !== 1) errors.push('Release receipt schemaVersion must be 1.');
  if (receipt?.candidate?.commitSha !== commitSha) errors.push('Release receipt is stale or names a different candidate SHA.');
  if (receipt?.candidate?.commitSha && SHA1.test(receipt.candidate.commitSha)) {
    try {
      if (candidateTree(repoRoot, commitSha) !== receipt.candidate.treeSha) errors.push('Release receipt candidate tree SHA is stale.');
      assertAncestor(repoRoot, receipt.candidate.baseSha, commitSha);
    } catch (error) {
      errors.push(error.message);
    }
  } else errors.push('Release receipt candidate commit/tree/base binding is incomplete.');
  try {
    const identities = [receipt?.ownerTask, receipt?.memoryAudit?.task, receipt?.independentReview?.task]
      .map(value => taskId(value, 'Release task identity').toLocaleLowerCase());
    if (new Set(identities).size !== identities.length) errors.push('Owner, memory auditor, and independent reviewer need distinct task identities.');
  } catch (error) {
    errors.push(error.message);
  }
  if (receipt?.memoryAudit?.outcome !== 'pass') errors.push('Memory audit receipt is not a pass.');
  if (receipt?.independentReview?.outcome !== 'approved') errors.push('Independent review receipt is not approved.');
  if (receipt?.independentReview?.reviewedSha !== commitSha) errors.push('Independent review does not name the exact candidate SHA.');
  for (const [key, label] of [['memoryAudit', 'Memory audit'], ['independentReview', 'Independent review']]) {
    try {
      validTime(receipt?.[key]?.completedAt, label);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (!Array.isArray(receipt?.memoryAudit?.sources) || receipt.memoryAudit.sources.length === 0 ||
      !receipt.memoryAudit.sources.every(source => typeof source.path === 'string' && path.isAbsolute(source.path) && SHA256.test(source.sha256 || ''))) {
    errors.push('Memory audit source list, absolute paths, or fingerprints are incomplete.');
  }
  try {
    memoryCloudSyncScope(receipt?.memoryAudit?.scope);
  } catch (error) {
    errors.push(error.message);
  }
  const scope = receipt?.independentReview?.scope;
  if (!scope || scope.fullDiff !== true || scope.relevantTests !== true || scope.userVisibleAndDataSafety !== true) {
    errors.push('Independent review scope is incomplete.');
  }
  if (typeof receipt?.independentReview?.summary !== 'string' || receipt.independentReview.summary.trim().length < 20) {
    errors.push('Independent review summary is missing or too short.');
  }
  for (const [key, file] of [['memoryAudit', 'memory-audit.md'], ['independentReview', 'independent-review.md']]) {
    const evidence = receipt?.[key]?.evidence;
    if (evidence?.file !== file || !SHA256.test(evidence?.sha256 || '')) {
      errors.push(key + ' evidence file binding is incomplete.');
      continue;
    }
    try {
      if (hashFile(path.join(directory, file)) !== evidence.sha256) errors.push(key + ' evidence SHA-256 does not match its copied bytes.');
    } catch {
      errors.push(key + ' evidence file is missing.');
    }
  }
  if (!SHA256.test(receipt?.receiptSha256 || '') || receiptDigest(receipt) !== receipt.receiptSha256) {
    errors.push('Release receipt manifest SHA-256 is invalid.');
  }
  return { ok: errors.length === 0, errors, receipt, receiptPath };
}

export function parsePrePushUpdates(input) {
  const updates = [];
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error('Pre-push input must contain local ref, local SHA, remote ref, and remote SHA.');
    updates.push({ localRef: fields[0], localSha: fields[1], remoteRef: fields[2], remoteSha: fields[3] });
  }
  return updates;
}

export function validatePrePushUpdates(repoRoot, updates) {
  const errors = [];
  const outgoing = updates.filter(update => update && update.localSha !== '0'.repeat(40));
  if (outgoing.length === 0) return errors;
  const status = git(repoRoot, ['status', '--porcelain', '--untracked-files=all']);
  if (status) errors.push('Release push blocked: the worktree must be clean while validating the exact candidate.');
  for (const update of outgoing) {
    if (!SHA1.test(update.localSha || '')) {
      errors.push('Release push blocked: outgoing ref ' + update.localRef + ' does not name a full commit SHA.');
      continue;
    }
    let commitSha;
    try {
      commitSha = git(repoRoot, ['rev-parse', update.localSha + '^{commit}']);
    } catch {
      errors.push('Release push blocked: outgoing ref ' + update.localRef + ' does not point to a local commit.');
      continue;
    }
    const result = verifyReleaseEvidence(repoRoot, commitSha);
    if (!result.ok) errors.push('Release push blocked for ' + update.localRef + ' at ' + commitSha + ': ' + result.errors.join(' '));
  }
  return errors;
}

export async function publishReleaseStatuses(repoRoot, commitSha, postStatus) {
  const result = verifyReleaseEvidence(repoRoot, commitSha);
  if (!result.ok) throw new Error('Cannot publish release statuses without a valid exact-SHA receipt: ' + result.errors.join(' '));
  if (typeof postStatus !== 'function') throw new Error('Status publication requires an authenticated GitHub status writer.');
  const description = 'receipt-sha256=' + result.receipt.receiptSha256 + ';base=' + result.receipt.candidate.baseSha;
  const targetUrl = 'https://github.com/' + git(repoRoot, ['remote', 'get-url', 'origin']).replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') + '/commit/' + commitSha;
  const base = result.receipt.candidate.baseSha;
  for (const context of RELEASE_STATUS_CONTEXTS) {
    await postStatus({ commitSha, context, state: 'success', description, targetUrl, baseSha: base });
  }
  return { commitSha, receiptSha256: result.receipt.receiptSha256, contexts: [...RELEASE_STATUS_CONTEXTS] };
}

async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error('GitHub API request failed with HTTP ' + response.status + '.');
  return response.json();
}

function latestByContext(statuses) {
  const latest = new Map();
  for (const status of statuses) {
    if (!status || typeof status.context !== 'string') continue;
    const time = Date.parse(status.created_at || '');
    if (!Number.isFinite(time)) throw new Error('A required commit status has no valid creation time.');
    const prior = latest.get(status.context);
    if (!prior || time > prior.time) latest.set(status.context, { status, time });
  }
  return latest;
}

export async function verifyDeploymentEvidence({ repository, deployedSha, beforeSha, token, fetchImpl = fetch }) {
  try {
    if (typeof repository !== 'string' || !/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must identify owner/repository.');
    if (!SHA1.test(deployedSha || '') || !SHA1.test(beforeSha || '') || beforeSha === '0'.repeat(40)) {
      throw new Error('Deployment needs full nonzero before and deployed commit SHAs.');
    }
    if (typeof token !== 'string' || !token.trim()) throw new Error('A read-only GitHub token is required to verify release evidence.');
    const api = 'https://api.github.com/repos/' + repository;
    const mainCommit = await githubJson(fetchImpl, api + '/commits/' + deployedSha, token);
    const baseSha = mainCommit.parents?.[0]?.sha;
    const treeSha = mainCommit.commit?.tree?.sha;
    if (baseSha !== beforeSha) throw new Error('The deployed main commit does not preserve the exact pre-deploy main base.');
    const associated = await githubJson(fetchImpl, api + '/commits/' + deployedSha + '/pulls?per_page=100', token);
    const merged = Array.isArray(associated) ? associated.filter(pr =>
      pr?.merge_commit_sha === deployedSha && pr?.merged_at && pr?.base?.ref === 'main' && SHA1.test(pr?.head?.sha || '')) : [];
    if (merged.length !== 1) throw new Error('Deployment must resolve to exactly one merged main pull request.');
    const headSha = merged[0].head.sha;
    const reviewedCommit = await githubJson(fetchImpl, api + '/commits/' + headSha, token);
    if (!treeSha || reviewedCommit.commit?.tree?.sha !== treeSha) {
      throw new Error('The reviewed pull request head tree does not exactly match the deployed main tree.');
    }
    const comparison = await githubJson(fetchImpl, api + '/compare/' + baseSha + '...' + headSha, token);
    if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
      throw new Error('The reviewed pull request head is not based on the exact main commit that was deployed.');
    }
    const statuses = await githubJson(fetchImpl, api + '/commits/' + headSha + '/statuses?per_page=100', token);
    if (!Array.isArray(statuses)) throw new Error('GitHub returned no status history for the exact reviewed head.');
    const latest = latestByContext(statuses);
    let receiptHash = null;
    for (const context of RELEASE_STATUS_CONTEXTS) {
      const status = latest.get(context)?.status;
      if (!status || status.state !== 'success') throw new Error('Latest exact-head status is missing or unsuccessful: ' + context + '.');
      const match = status.description?.match(/^receipt-sha256=([0-9a-f]{64});base=([0-9a-f]{40})$/);
      if (!match || match[2] !== baseSha) throw new Error('Required exact-head status is not bound to the deployed base and receipt digest: ' + context + '.');
      if (receiptHash && receiptHash !== match[1]) throw new Error('Memory and independent-review statuses name different evidence receipts.');
      receiptHash = match[1];
    }
    return { ok: true, errors: [], deployedSha, reviewedSha: headSha, treeSha, baseSha, receiptSha256: receiptHash };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

function githubRepository(repoRoot) {
  const remote = git(repoRoot, ['remote', 'get-url', 'origin']);
  const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (!match) throw new Error('Origin must be a GitHub owner/repository remote for release status publication.');
  return match[1];
}

function postWithGh(repository, payload) {
  const args = [
    'api', '--method', 'POST', 'repos/' + repository + '/statuses/' + payload.commitSha,
    '-f', 'state=success',
    '-f', 'context=' + payload.context,
    '-f', 'description=' + payload.description,
    '-f', 'target_url=' + payload.targetUrl,
  ];
  try {
    execFileSync('gh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    throw new Error('Could not publish required GitHub status ' + payload.context + ': ' + String(error.stderr || error.message).trim());
  }
}

async function main() {
  const command = process.argv[2];
  const repoRoot = process.cwd();
  if (command === 'record') {
    const inputPath = process.argv[3];
    if (!inputPath) throw new Error('Usage: node scripts/release-evidence.mjs record <receipt-input.json>');
    const recorded = recordReleaseEvidence(repoRoot, JSON.parse(fs.readFileSync(inputPath, 'utf8')));
    process.stdout.write('Recorded exact-SHA release evidence for ' + recorded.receipt.candidate.commitSha + ' (receipt ' + recorded.receipt.receiptSha256 + ').\n');
    return;
  }
  if (command === 'verify') {
    const commitSha = process.argv[3];
    if (!commitSha) throw new Error('Usage: node scripts/release-evidence.mjs verify <candidate-sha>');
    const result = verifyReleaseEvidence(repoRoot, commitSha);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    process.stdout.write('Exact-SHA memory and independent-review evidence is valid for ' + commitSha + '.\n');
    return;
  }
  if (command === 'pre-push') {
    const input = fs.readFileSync(0, 'utf8');
    const errors = validatePrePushUpdates(repoRoot, parsePrePushUpdates(input));
    if (errors.length) throw new Error(errors.join('\n'));
    process.stdout.write('Every outgoing commit tip has valid exact-SHA release evidence.\n');
    return;
  }
  if (command === 'publish') {
    const commitSha = process.argv[3];
    const repository = githubRepository(repoRoot);
    const result = await publishReleaseStatuses(repoRoot, commitSha, payload => postWithGh(repository, payload));
    process.stdout.write('Published memory-audit and independent-review statuses for exact SHA ' + result.commitSha + '.\n');
    return;
  }
  if (command === 'verify-deployment') {
    const result = await verifyDeploymentEvidence({
      repository: process.env.GITHUB_REPOSITORY,
      deployedSha: process.argv[3] || process.env.GITHUB_SHA,
      beforeSha: process.argv[4] || process.env.GITHUB_EVENT_BEFORE,
      token: process.env.GITHUB_TOKEN,
    });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    process.stdout.write('Merged PR release evidence passed for deployed SHA ' + result.deployedSha + ' and reviewed SHA ' + result.reviewedSha + '.\n');
    return;
  }
  throw new Error('Commands: record, verify, pre-push, publish, verify-deployment.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
