import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RELEASE_STATUS_CONTEXTS = Object.freeze([
  'funsidething/memory-audit',
  'funsidething/independent-review',
  'funsidething/specialist-review',
]);
export const RISK_BASED_RELEASE_STATUS_CONTEXTS = Object.freeze([...RELEASE_STATUS_CONTEXTS]);

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const receiptRootName = 'funsidething-release-evidence';
const specialistDomainNames = new Set([
  'data-migration',
  'memory-cloud-sync',
  'release-process',
  'security-deployment',
  'shared-session-state',
]);
const genericPersistenceCallPattern = /\b(?:adapter|store|repository|repo|persistence|storage|database|db)\s*(?:\.\s*|\[\s*['"])(?:set|put|update|write|mutate|remove|clear|delete|erase)\b(?:['"]\s*\])?\s*\(/i;

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function gitRaw(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
}

function gitShow(repoRoot, commitSha, file) {
  const result = spawnSync('git', ['-C', repoRoot, 'show', `${commitSha}:${file}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
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

function hasFocusedMemoryCloudSyncTests(scope) {
  return Object.values(scope).some(entry => entry.tests.length > 0);
}

function normalizeAdditionalSpecialistDomains(domains, field = 'additionalSpecialistDomains') {
  if (!Array.isArray(domains)) throw new Error(field + ' must be an array of known specialist domains.');
  const normalized = domains.map(domain => {
    if (typeof domain !== 'string' || !specialistDomainNames.has(domain)) {
      throw new Error(field + ' contains an unrecognized specialist domain.');
    }
    return domain;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error(field + ' must not contain duplicate specialist domains.');
  return normalized.sort();
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

const policyFiles = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'RELEASE_GATES.md',
  'RISK_TEST_COVERAGE.md',
  'TEST_CHANGE_RATIONALES.json',
  'scripts/test-first-gate.mjs',
  'scripts/release-evidence.mjs',
  'scripts/install-release-hook.mjs',
]);
const documentationExtensions = /\.(?:md|mdx|rst|txt)$/i;
const commentReviewExtensions = /\.(?:js|mjs|cjs|ts|css|scss)$/i;
const riskDocumentationPath = /(?:release.?gate|test.?first|risk.?test|memory|cloud|sync|storage|persist|backup|recovery|migration|firestore|auth|security|deploy|session|rules)/i;

function isReleaseProcessPath(file) {
  const normalized = file.toLowerCase().replaceAll('\\', '/');
  return policyFiles.has(file) || /^\.github\/workflows\//.test(normalized) || /^\.claude\/hooks\//.test(normalized) ||
    /(?:release.?gate|test.?first|release.?evidence|install-release-hook)/.test(normalized);
}

function stripSourceComments(source, extension) {
  if (/\\(?:\r\n|\r|\n)/.test(source)) return null;
  if (['.js', '.mjs', '.cjs', '.ts'].includes(extension) && source.includes('`')) return null;
  if (/(?:eslint-(?:disable|enable)|@ts-(?:ignore|expect-error|nocheck|check)|sourceURL|sourceMappingURL|istanbul|c8\s+ignore|webpack[A-Za-z]+|vite-ignore)/i.test(source)) return null;
  const supportsLineComments = !['.css'].includes(extension);
  let output = '';
  let index = 0;
  const appendCommentSeparator = comment => {
    const newline = comment.match(/\r\n|\r|\n/)?.[0];
    if (newline) {
      if (output && !/(?:\r\n|\r|\n)$/.test(output)) output += newline;
    } else if (output && !/\s$/.test(output)) output += ' ';
  };
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'") {
      const quote = character;
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) {
          cursor++;
          closed = true;
          break;
        }
        if (source[cursor] === '\n' || source[cursor] === '\r') return null;
        cursor++;
      }
      if (!closed) return null;
      output += source.slice(index, cursor);
      index = cursor;
      continue;
    }
    if (character === '/' && source[index + 1] === '/' && supportsLineComments) {
      let cursor = index + 2;
      while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') cursor++;
      appendCommentSeparator(source.slice(index, cursor === source.length ? cursor : cursor + 1));
      index = cursor + (source[cursor] === '\r' && source[cursor + 1] === '\n' ? 2 : source[cursor] === '\n' || source[cursor] === '\r' ? 1 : 0);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) return null;
      const comment = source.slice(index, end + 2);
      // CSS comments are removed rather than replaced with token-separating
      // whitespace. Treating them like JavaScript comments would misclassify
      // selectors such as `a/**/b` as comment-only edits.
      if (extension !== '.css') appendCommentSeparator(comment);
      index = end + 2;
      continue;
    }
    output += character;
    index++;
  }
  return output.trimEnd();
}

function commentOnlyDiff(repoRoot, baseSha, commitSha, file) {
  if (!commentReviewExtensions.test(file) || file === 'tests.js' || isReleaseProcessPath(file)) return false;
  const extension = path.extname(file).toLowerCase();
  const before = gitShow(repoRoot, baseSha, file);
  const after = gitShow(repoRoot, commitSha, file);
  if (before === null || after === null) return false;
  if (before === after) return false;
  const beforeCode = stripSourceComments(before, extension);
  const afterCode = stripSourceComments(after, extension);
  return beforeCode !== null && afterCode !== null && beforeCode === afterCode;
}

function isDocumentationOnlyPath(file) {
  const normalized = file.replaceAll('\\', '/');
  if (!documentationExtensions.test(normalized)) return false;
  if (policyFiles.has(normalized)) return false;
  return !riskDocumentationPath.test(normalized);
}

function reviewDomainsForPath(file) {
  const normalized = file.toLowerCase().replaceAll('\\', '/');
  const domains = new Set();
  if (isReleaseProcessPath(file)) domains.add('release-process');
  if (/(?:cloud|firestore|sync|storage|persist|backup|recovery|migration|indexeddb|localstorage|local-storage|account)/.test(normalized)) {
    domains.add('memory-cloud-sync');
  }
  if (/(?:session|shared-state)/.test(normalized)) domains.add('shared-session-state');
  if (/(?:auth|callable|functions|guard|security|firestore\.rules|firebase|rules|deploy|workflow|permission)/.test(normalized)) {
    domains.add('security-deployment');
  }
  if (/(?:migration|migrat|schema)/.test(normalized)) domains.add('data-migration');
  return [...domains].sort();
}

function reviewDomainsFromDiff(repoRoot, baseSha, commitSha, file) {
  const normalized = file.toLowerCase().replaceAll('\\', '/');
  const domains = new Set();
  const patch = gitRaw(repoRoot, ['diff', '--unified=2', '--no-renames', baseSha, commitSha, '--', file]);
  const context = patch.split(/\r?\n/).filter(line =>
    line && !line.startsWith('+++') && !line.startsWith('---') && !line.startsWith('@@')).join('\n');
  // Opaque persistence objects and their mutating methods carry data-safety risk.
  if (/(?:localstorage|sessionstorage|indexeddb|firestore|cloud(?:pull|push|sync|data)?|sync(?:hroniz|ing|ed)?|persist\w*|backup|recover|hydrate\w*|reconcil|revision|serverUpdatedAt|save\w*|load\w*|store\w*|storage\w*|snapshot\w*|serialize\w*|deserialize\w*|boardStore)/i.test(context) || genericPersistenceCallPattern.test(context)) {
    domains.add('memory-cloud-sync');
  }
  if (/(?:session|sharedState|currentUser|userId|accountId|BroadcastChannel)/i.test(context)) domains.add('shared-session-state');
  if (/(?:auth|firebase|callable|onCall|onRequest|httpsCallable|https\.on(?:Call|Request)|signIn|signOut|token|credential|ownerUid|firestore\.rules|authorization|claims|permission|provider|login|\b(?:role|owner|admin|privilege)\w*\b)/i.test(context)) {
    domains.add('security-deployment');
  }
  if (/(?:migration|migrat|schemaVersion|schema version|upgradeDatabase|versionchange)/i.test(context)) domains.add('data-migration');
  if (/(?:^|\/)\.github\/workflows\//.test(normalized)) domains.add('release-process');
  return [...domains].sort();
}

export function deriveReleaseReviewPlan(repoRoot, commitSha, baseSha, options = {}) {
  candidateTree(repoRoot, commitSha);
  assertAncestor(repoRoot, baseSha, commitSha);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Review-plan options must be an object.');
  }
  const additionalSpecialistDomains = Object.hasOwn(options, 'additionalSpecialistDomains')
    ? normalizeAdditionalSpecialistDomains(options.additionalSpecialistDomains)
    : [];
  const changedFiles = gitRaw(repoRoot, ['diff', '--name-only', '--no-renames', '-z', baseSha, commitSha, '--'])
    .split('\0').filter(Boolean).sort();
  let requiresCodeReview = false;
  const specialistDomains = new Set();
  for (const file of changedFiles) {
    const documentationOnly = isDocumentationOnlyPath(file);
    const commentsOnly = commentOnlyDiff(repoRoot, baseSha, commitSha, file);
    if (!documentationOnly && !commentsOnly) requiresCodeReview = true;
    if (!commentsOnly) {
      for (const domain of reviewDomainsForPath(file)) specialistDomains.add(domain);
      for (const domain of reviewDomainsFromDiff(repoRoot, baseSha, commitSha, file)) specialistDomains.add(domain);
    }
  }
  for (const domain of additionalSpecialistDomains) specialistDomains.add(domain);
  const domains = [...specialistDomains].sort();
  const requiresSpecialistReview = domains.length > 0;
  const mode = requiresCodeReview && requiresSpecialistReview ? 'dual-review' :
    requiresCodeReview ? 'independent-review' :
    requiresSpecialistReview ? 'specialist-review' : 'owner-self-review';
  return {
    schemaVersion: 1,
    changedFiles,
    mode,
    requiresCodeReview,
    ...(requiresCodeReview && [commitSha,baseSha].some(sha=>(gitShow(repoRoot,sha,"AGENTS.md")||"").includes("Independent FAQ coverage review is required")) ? { requiresFaqReview: true } : {}),
    requiresSpecialistReview,
    specialistDomains: domains,
  };
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
  if(deriveReleaseReviewPlan(repoRoot,commitSha,baseSha).requiresFaqReview)throw new Error('FAQ coverage policy requires schemaVersion 2 evidence.');
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

function exactReviewScope(scope, field) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || scope.fullDiff !== true ||
      scope.relevantTests !== true || scope.userVisibleAndDataSafety !== true) {
    throw new Error(field + ' must cover the full diff, relevant tests, and user-visible or data-safety effects.');
  }
  return { fullDiff: true, relevantTests: true, userVisibleAndDataSafety: true };
}

function validatedMemorySources(sources, field, verifyNow) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(field + ' must name the current source files and evidence fingerprints it checked.');
  }
  return sources.map(source => {
    if (!source || typeof source.path !== 'string' || source.path.trim().length < 3 || !path.isAbsolute(source.path) ||
        !SHA256.test(source.sha256 || '')) {
      throw new Error(field + ' sources need absolute paths and SHA-256 fingerprints.');
    }
    if (verifyNow) {
      const resolved = path.resolve(source.path);
      if (!fs.statSync(resolved).isFile() || hashFile(resolved) !== source.sha256) {
        throw new Error(field + ' source fingerprint does not match the source read at review time: ' + source.path);
      }
    }
    return { path: source.path, sha256: source.sha256 };
  });
}

function validateRiskBasedInput(repoRoot, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 2) {
    throw new Error('Risk-based release evidence input must use schemaVersion 2.');
  }
  const commitSha = input.candidate?.commitSha;
  const treeSha = input.candidate?.treeSha;
  const baseSha = input.candidate?.baseSha;
  const actualTree = candidateTree(repoRoot, commitSha);
  if (!SHA1.test(treeSha || '') || actualTree !== treeSha) throw new Error('Candidate tree SHA does not match the exact commit.');
  assertAncestor(repoRoot, baseSha, commitSha);
  const additionalSpecialistDomains = Object.hasOwn(input, 'additionalSpecialistDomains')
    ? normalizeAdditionalSpecialistDomains(input.additionalSpecialistDomains)
    : [];
  const reviewPlan = deriveReleaseReviewPlan(repoRoot, commitSha, baseSha, { additionalSpecialistDomains });
  const owner = input.ownerReview;
  const ownerTask = taskId(owner?.task, 'ownerReview.task');
  if (owner?.outcome !== 'approved') throw new Error('Owner exact-diff review must be approved.');
  if (owner.reviewedSha !== commitSha) throw new Error('Owner review must name the exact candidate SHA.');
  const ownerTime = validTime(owner.completedAt, 'Owner exact-diff review');
  if (typeof owner.summary !== 'string' || owner.summary.trim().length < 20) {
    throw new Error('Owner exact-diff review must record a specific summary.');
  }
  if (!owner.scope || owner.scope.fullDiff !== true || typeof owner.scope.rationale !== 'string' || owner.scope.rationale.trim().length < 20) {
    throw new Error('Owner review must attest to the full exact diff and record a specific risk rationale.');
  }
  const ownerBytes = evidenceFile(repoRoot, owner.evidencePath, owner.evidenceSha256, 'Owner exact-diff review');
  const identities = [ownerTask];
  let independentReview;
  let independentBytes;
  if (reviewPlan.requiresCodeReview) {
    const review = input.independentReview;
    const task = taskId(review?.task, 'independentReview.task');
    if (task.toLocaleLowerCase() === ownerTask.toLocaleLowerCase()) throw new Error('Owner and independent reviewer need distinct task identities.');
    if (review?.outcome !== 'approved') throw new Error('Required independent code review must be approved.');
    if (review.reviewedSha !== commitSha) throw new Error('Independent code review must name the exact candidate SHA.');
    const completedAt = validTime(review.completedAt, 'Independent code review');
    if (typeof review.summary !== 'string' || review.summary.trim().length < 20) {
      throw new Error('Independent code review must record a specific summary.');
    }
    const scope = exactReviewScope(review.scope, 'Independent code review');
    independentBytes = evidenceFile(repoRoot, review.evidencePath, review.evidenceSha256, 'Independent code review');
    independentReview = { task, outcome: 'approved', reviewedSha: commitSha, completedAt,
      summary: review.summary.trim(), scope,
      evidence: { file: 'independent-review.md', sha256: sha256(independentBytes) } };
    identities.push(task);
  } else if (input.independentReview) {
    throw new Error('This exact diff does not require a code reviewer; omit independentReview from the receipt.');
  }
  let specialistReview;
  let specialistBytes;
  if (reviewPlan.requiresSpecialistReview) {
    const review = input.specialistReview;
    const task = taskId(review?.task, 'specialistReview.task');
    if (task.toLocaleLowerCase() === ownerTask.toLocaleLowerCase()) throw new Error('Owner and specialist reviewer need distinct task identities.');
    if (review?.outcome !== 'approved') throw new Error('Required specialist review must be approved.');
    if (review.reviewedSha !== commitSha) throw new Error('Specialist review must name the exact candidate SHA.');
    const completedAt = validTime(review.completedAt, 'Specialist review');
    if (typeof review.summary !== 'string' || review.summary.trim().length < 20) {
      throw new Error('Specialist review must record a specific summary.');
    }
    const scope = exactReviewScope(review.scope, 'Specialist review');
    const domains = Array.isArray(review.domains) ? [...review.domains].sort() : [];
    if (canonicalJson(domains) !== canonicalJson(reviewPlan.specialistDomains)) {
      throw new Error('Specialist review domains must exactly match the high-risk domains in the candidate diff.');
    }
    let memoryScope;
    let sources;
    if (reviewPlan.specialistDomains.includes('memory-cloud-sync')) {
      memoryScope = memoryCloudSyncScope(review.memoryScope, 'specialistReview.memoryScope');
      if (!hasFocusedMemoryCloudSyncTests(memoryScope)) {
        throw new Error('A memory, cloud, or sync specialist review must include focused tests for the assessed domains, even when none are affected.');
      }
      sources = validatedMemorySources(review.sources, 'Specialist memory/cloud/sync review', true);
    }
    specialistBytes = evidenceFile(repoRoot, review.evidencePath, review.evidenceSha256, 'Specialist review');
    specialistReview = { task, outcome: 'approved', reviewedSha: commitSha, completedAt,
      domains, summary: review.summary.trim(), scope,
      ...(memoryScope ? { memoryScope, sources } : {}),
      evidence: { file: 'specialist-review.md', sha256: sha256(specialistBytes) } };
    identities.push(task);
  } else if (input.specialistReview) {
    throw new Error('This exact diff does not require a specialist reviewer; omit specialistReview from the receipt.');
  }
  let faqReview,faqBytes;
  if(reviewPlan.requiresFaqReview){
    const review=input.faqReview;
    const task=taskId(review?.task,'FAQ review task');
    if(review.outcome!=='approved')throw new Error('Required FAQ review must be approved.');
    if(review.reviewedSha!==commitSha)throw new Error('FAQ review must name the exact candidate SHA.');
    const completedAt=validTime(review.completedAt,'FAQ review');
    if(typeof review.summary!=='string'||review.summary.trim().length<20)throw new Error('FAQ review must record a specific coverage summary.');
    const scope=exactReviewScope(review.scope,'FAQ review');
    faqBytes=evidenceFile(repoRoot,review.evidencePath,review.evidenceSha256,'FAQ review');
    faqReview={task,outcome:'approved',reviewedSha:commitSha,completedAt,summary:review.summary.trim(),scope,evidence:{file:'faq-review.md',sha256:sha256(faqBytes)}};
    identities.push(task);
  }else if(input.faqReview)throw new Error('This exact diff does not require FAQ review.');
  if (new Set(identities.map(value => value.toLocaleLowerCase())).size !== identities.length) {
    throw new Error('Owner, code reviewer, and specialist reviewer need distinct task identities.');
  }
  const receipt = {
    schemaVersion: 2,
    candidate: { commitSha, treeSha, baseSha },
    additionalSpecialistDomains,
    reviewPlan,
    ownerReview: {
      task: ownerTask,
      outcome: 'approved',
      reviewedSha: commitSha,
      completedAt: ownerTime,
      summary: owner.summary.trim(),
      scope: { fullDiff: true, rationale: owner.scope.rationale.trim() },
      evidence: { file: 'owner-review.md', sha256: sha256(ownerBytes) },
    },
    ...(independentReview ? { independentReview } : {}),
    ...(specialistReview ? { specialistReview } : {}),
    ...(faqReview ? { faqReview } : {}),
  };
  return {
    receipt,
    evidenceFiles: [
      { name: 'owner-review.md', bytes: ownerBytes },
      ...(independentBytes ? [{ name: 'independent-review.md', bytes: independentBytes }] : []),
      ...(specialistBytes ? [{ name: 'specialist-review.md', bytes: specialistBytes }] : []),
      ...(faqBytes ? [{ name: 'faq-review.md', bytes: faqBytes }] : []),
    ],
  };
}

function receiptDirectory(repoRoot, commitSha) {
  const { common } = gitCommonDir(repoRoot);
  return path.join(common, receiptRootName, commitSha);
}

export function recordReleaseEvidence(repoRoot, input) {
  const { root } = gitCommonDir(repoRoot);
  const validated = input?.schemaVersion === 2 ? validateRiskBasedInput(root, input) : validateInput(root, input);
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
    if (receipt.schemaVersion === 1) {
      fs.writeFileSync(path.join(directory, 'memory-audit.md'), validated.memoryBytes, { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(path.join(directory, 'independent-review.md'), validated.reviewBytes, { flag: 'wx', mode: 0o600 });
    } else {
      for (const evidence of validated.evidenceFiles) {
        fs.writeFileSync(path.join(directory, evidence.name), evidence.bytes, { flag: 'wx', mode: 0o600 });
      }
    }
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

function verifyRiskBasedReceipt(repoRoot, commitSha, receipt, receiptPath) {
  const errors = [];
  if (receipt?.candidate?.commitSha !== commitSha) errors.push('Release receipt is stale or names a different candidate SHA.');
  if (receipt?.candidate?.commitSha && SHA1.test(receipt.candidate.commitSha)) {
    try {
      if (candidateTree(repoRoot, commitSha) !== receipt.candidate.treeSha) errors.push('Release receipt candidate tree SHA is stale.');
      assertAncestor(repoRoot, receipt.candidate.baseSha, commitSha);
    } catch (error) {
      errors.push(error.message);
    }
  } else errors.push('Release receipt candidate commit/tree/base binding is incomplete.');
  let expectedPlan;
  try {
    const additionalSpecialistDomains = receipt && Object.hasOwn(receipt, 'additionalSpecialistDomains')
      ? normalizeAdditionalSpecialistDomains(receipt.additionalSpecialistDomains, 'Release receipt additionalSpecialistDomains')
      : [];
    expectedPlan = deriveReleaseReviewPlan(repoRoot, commitSha, receipt?.candidate?.baseSha, { additionalSpecialistDomains });
    if (canonicalJson(receipt?.reviewPlan) !== canonicalJson(expectedPlan)) {
      errors.push('Release receipt review plan does not match the exact candidate diff classification.');
    }
  } catch (error) {
    errors.push('Could not verify the exact-diff review plan: ' + error.message);
  }
  const plan = expectedPlan;
  const owner = receipt?.ownerReview;
  try {
    taskId(owner?.task, 'Owner exact-diff review task');
  } catch (error) {
    errors.push(error.message);
  }
  if (owner?.outcome !== 'approved') errors.push('Owner exact-diff review is not approved.');
  if (owner?.reviewedSha !== commitSha) errors.push('Owner exact-diff review does not name the exact candidate SHA.');
  try {
    validTime(owner?.completedAt, 'Owner exact-diff review');
  } catch (error) {
    errors.push(error.message);
  }
  if (typeof owner?.summary !== 'string' || owner.summary.trim().length < 20 ||
      owner?.scope?.fullDiff !== true || typeof owner?.scope?.rationale !== 'string' || owner.scope.rationale.trim().length < 20) {
    errors.push('Owner exact-diff review summary or full-diff risk rationale is incomplete.');
  }
  const identities = [];
  try {
    identities.push(taskId(owner?.task, 'Owner exact-diff review task').toLocaleLowerCase());
  } catch {}
  const checkIndependent = (field, required) => {
    const review = receipt?.[field];
    if (Boolean(review) !== required) {
      errors.push(required ? 'Required independent code review is missing.' : 'Receipt includes an independent code review not required by the exact diff.');
      if (!review) return;
    }
    if (!review) return;
    try {
      identities.push(taskId(review.task, 'Independent code review task').toLocaleLowerCase());
    } catch (error) {
      errors.push(error.message);
    }
    if (review.outcome !== 'approved') errors.push('Independent code review is not approved.');
    if (review.reviewedSha !== commitSha) errors.push('Independent code review does not name the exact candidate SHA.');
    try {
      validTime(review.completedAt, 'Independent code review');
    } catch (error) {
      errors.push(error.message);
    }
    try {
      exactReviewScope(review.scope, 'Independent code review');
    } catch (error) {
      errors.push(error.message);
    }
    if (typeof review.summary !== 'string' || review.summary.trim().length < 20) errors.push('Independent code review summary is missing or too short.');
  };
  const checkSpecialist = (required, domains) => {
    const review = receipt?.specialistReview;
    if (Boolean(review) !== required) {
      errors.push(required ? 'Required specialist review is missing.' : 'Receipt includes specialist review not required by the exact diff.');
      if (!review) return;
    }
    if (!review) return;
    try {
      identities.push(taskId(review.task, 'Specialist review task').toLocaleLowerCase());
    } catch (error) {
      errors.push(error.message);
    }
    if (review.outcome !== 'approved') errors.push('Specialist review is not approved.');
    if (review.reviewedSha !== commitSha) errors.push('Specialist review does not name the exact candidate SHA.');
    try {
      validTime(review.completedAt, 'Specialist review');
    } catch (error) {
      errors.push(error.message);
    }
    try {
      exactReviewScope(review.scope, 'Specialist review');
    } catch (error) {
      errors.push(error.message);
    }
    if (typeof review.summary !== 'string' || review.summary.trim().length < 20) errors.push('Specialist review summary is missing or too short.');
    const actualDomains = Array.isArray(review.domains) ? [...review.domains].sort() : [];
    if (canonicalJson(actualDomains) !== canonicalJson(domains)) errors.push('Specialist review domains do not match the exact diff.');
    if (domains.includes('memory-cloud-sync')) {
      try {
        const scope = memoryCloudSyncScope(review.memoryScope, 'specialistReview.memoryScope');
        if (!hasFocusedMemoryCloudSyncTests(scope)) {
          errors.push('Specialist memory/cloud/sync review must include focused tests for the assessed domains, even when none are affected.');
        }
      } catch (error) {
        errors.push(error.message);
      }
      if (!Array.isArray(review.sources) || review.sources.length === 0 ||
          !review.sources.every(source => typeof source.path === 'string' && path.isAbsolute(source.path) && SHA256.test(source.sha256 || ''))) {
        errors.push('Specialist memory/cloud/sync source paths or fingerprints are incomplete.');
      }
    }
  };
  if (plan) {
    checkIndependent('independentReview', plan.requiresCodeReview);
    checkIndependent('faqReview', Boolean(plan.requiresFaqReview));
    checkSpecialist(plan.requiresSpecialistReview, plan.specialistDomains);
  } else {
    checkIndependent('independentReview', Boolean(receipt?.independentReview));
    checkIndependent('faqReview', Boolean(receipt?.faqReview));
    checkSpecialist(Boolean(receipt?.specialistReview), Array.isArray(receipt?.specialistReview?.domains) ? receipt.specialistReview.domains : []);
  }
  if (new Set(identities).size !== identities.length) errors.push('Owner, code reviewer, and specialist reviewer need distinct task identities.');
  const evidenceBindings = [
    ['ownerReview', 'owner-review.md'],
    ...(receipt?.independentReview ? [['independentReview', 'independent-review.md']] : []),
    ...(receipt?.specialistReview ? [['specialistReview', 'specialist-review.md']] : []),
    ...(receipt?.faqReview ? [['faqReview', 'faq-review.md']] : []),
  ];
  for (const [key, file] of evidenceBindings) {
    const evidence = receipt?.[key]?.evidence;
    if (evidence?.file !== file || !SHA256.test(evidence?.sha256 || '')) {
      errors.push(key + ' evidence file binding is incomplete.');
      continue;
    }
    try {
      if (hashFile(path.join(path.dirname(receiptPath), file)) !== evidence.sha256) errors.push(key + ' evidence SHA-256 does not match its copied bytes.');
    } catch {
      errors.push(key + ' evidence file is missing.');
    }
  }
  if (!SHA256.test(receipt?.receiptSha256 || '') || receiptDigest(receipt) !== receipt.receiptSha256) {
    errors.push('Release receipt manifest SHA-256 is invalid.');
  }
  return { ok: errors.length === 0, errors, receipt, receiptPath };
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
  if (receipt?.schemaVersion === 2) return verifyRiskBasedReceipt(repoRoot, commitSha, receipt, receiptPath);
  try{if(deriveReleaseReviewPlan(repoRoot,commitSha,receipt?.candidate?.baseSha).requiresFaqReview)errors.push('FAQ coverage policy requires schemaVersion 2 evidence.');}catch(error){errors.push(error.message);}
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
  const riskBased = result.receipt.schemaVersion === 2;
  const description = riskBased
    ? 'r=' + result.receipt.receiptSha256 + ';b=' + result.receipt.candidate.baseSha +
      ';p=' + sha256(Buffer.from(canonicalJson(result.receipt.reviewPlan))).slice(0, 12) +
      ';c=' + (result.receipt.reviewPlan.requiresCodeReview ? '1' : '0') +
      ';s=' + (result.receipt.reviewPlan.requiresSpecialistReview ? '1' : '0') + (result.receipt.reviewPlan.requiresFaqReview ? ';v=3' : ';v=2')
    : 'receipt-sha256=' + result.receipt.receiptSha256 + ';base=' + result.receipt.candidate.baseSha;
  const targetUrl = 'https://github.com/' + git(repoRoot, ['remote', 'get-url', 'origin']).replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') + '/commit/' + commitSha;
  const base = result.receipt.candidate.baseSha;
  const contexts = riskBased ? RISK_BASED_RELEASE_STATUS_CONTEXTS : RELEASE_STATUS_CONTEXTS;
  if (riskBased && description.length > 140) throw new Error('Risk-based release status description exceeds GitHub’s 140-character limit.');
  for (const context of contexts) {
    await postStatus({ commitSha, context, state: 'success', description, targetUrl, baseSha: base });
  }
  return { commitSha, receiptSha256: result.receipt.receiptSha256, contexts: [...contexts] };
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

export async function verifyDeploymentEvidence({ repository, deployedSha, beforeSha, token, fetchImpl = fetch, repoRoot = process.cwd() }) {
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
    // CI checks out complete history: derive the same exact plan as the local
    // recorder, including the prose-only exemption and a removed base policy.
    // Real deployed checkouts fail closed when their review objects are absent.
    const localHead=spawnSync('git',['-C',repoRoot,'cat-file','-e',headSha+'^{commit}']).status===0;
    const localDeployment=spawnSync('git',['-C',repoRoot,'cat-file','-e',deployedSha+'^{commit}']).status===0;
    if(localDeployment&&!localHead)throw new Error('Exact FAQ policy review head is unavailable; use a full release-evidence checkout.');
    const faqPolicy=localHead ? !!deriveReleaseReviewPlan(repoRoot,headSha,baseSha).requiresFaqReview : false;
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
    const riskBasedDescription = latest.get('funsidething/specialist-review')?.status?.description ||
      latest.get('funsidething/independent-review')?.status?.description || '';
    if(faqPolicy&&!/;v=3$/.test(riskBasedDescription))throw new Error('FAQ coverage policy requires FAQ-approved exact-head deployment evidence.');
    if (/;v=[23]$/.test(riskBasedDescription)) {
      const statusPlan = new Map();
      for (const context of RISK_BASED_RELEASE_STATUS_CONTEXTS) {
        const status = latest.get(context)?.status;
        if (!status || status.state !== 'success') throw new Error('Latest exact-head status is missing or unsuccessful: ' + context + '.');
        const match = status.description?.match(/^r=([0-9a-f]{64});b=([0-9a-f]{40});p=([0-9a-f]{12});c=([01]);s=([01]);v=([23])$/);
        if (!match || match[2] !== baseSha) throw new Error('Risk-based exact-head status is not bound to the deployed base and receipt: ' + context + '.');
        statusPlan.set(context, match.slice(1));
      }
      const descriptors = [...statusPlan.values()];
      if (descriptors.some(value => canonicalJson(value) !== canonicalJson(descriptors[0]))) {
        throw new Error('Risk-based exact-head statuses disagree about the receipt or required review plan.');
      }
      const [receiptHash, , , codeRequired, specialistRequired] = descriptors[0];
      if (codeRequired === '1' && !latest.get('funsidething/independent-review')?.status) {
        throw new Error('The exact diff requires an independent code review status.');
      }
      if (specialistRequired === '1' && !latest.get('funsidething/specialist-review')?.status) {
        throw new Error('The exact diff requires a specialist review status.');
      }
      return { ok: true, errors: [], deployedSha, reviewedSha: headSha, treeSha, baseSha, receiptSha256: receiptHash,
        reviewPlanPrefix: descriptors[0][2], requiresCodeReview: codeRequired === '1', requiresSpecialistReview: specialistRequired === '1' };
    }
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
    process.stdout.write((result.receipt.schemaVersion === 2
      ? 'Exact-SHA risk-based release evidence is valid for '
      : 'Legacy exact-SHA memory and independent-review evidence is valid for ') + commitSha + '.\n');
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
    process.stdout.write('Published ' + result.contexts.length + ' validated release status contexts for exact SHA ' + result.commitSha + '.\n');
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
    process.stdout.write('Merged PR exact-SHA release evidence passed for deployed SHA ' + result.deployedSha + ' and reviewed SHA ' + result.reviewedSha + '.\n');
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
