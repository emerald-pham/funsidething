#!/usr/bin/env node
// Compares the required status checks GitHub enforces on a branch with the set
// committed in the repository (#2216). Branch protection is GitHub-side state,
// so without this a ruleset edit could silently drop a required check and the
// repository would never notice. Run nightly by .github/workflows/nightly.yml.
//
// It reads GET /repos/{owner}/{repo}/rules/branches/{branch}: the rules that
// actually apply to the branch from every active ruleset, readable with plain
// repository read access, so the default workflow token is enough.
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--repository', '--branch', '--expected'].includes(key) || value === undefined) throw new Error(`Unknown or incomplete argument ${key}. Usage: ruleset-drift.mjs --repository owner/repo --branch main --expected file.json`);
    options[key.slice(2)] = value;
  }
  for (const key of ['repository', 'branch', 'expected']) if (!options[key]) throw new Error(`--${key} is required.`);
  return options;
}

// A check bound to an app (integration) can only be satisfied by that app, so
// the binding is part of the check's identity: dropping it would let any token
// with status access satisfy the required CI check.
const checkKey = check => check.integrationId == null ? check.context : `${check.context} (app ${check.integrationId})`;

async function liveRequiredChecks({ repository, branch }) {
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let url = `${api}/repos/${repository}/rules/branches/${encodeURIComponent(branch)}?per_page=100`;
  const checks = new Map();
  while (url) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for ${url}.`);
    let rules;
    try { rules = await response.json(); } catch { throw new Error(`GitHub returned a body that is not JSON for ${url}.`); }
    if (!Array.isArray(rules)) throw new Error(`GitHub returned ${JSON.stringify(rules).slice(0, 200)} instead of a rule list for ${url}.`);
    for (const rule of rules) {
      if (rule.type !== 'required_status_checks') continue;
      for (const check of rule.parameters?.required_status_checks || []) {
        const normalized = { context: check.context, integrationId: check.integration_id ?? null };
        checks.set(checkKey(normalized), normalized);
      }
    }
    url = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
  }
  return [...checks.keys()];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const committed = JSON.parse(readFileSync(options.expected, 'utf8'));
  const expected = committed.requiredStatusChecks.map(check => checkKey({ context: check.context, integrationId: check.integrationId ?? null }));
  let live;
  try {
    live = await liveRequiredChecks(options);
  } catch (error) {
    // An unreadable ruleset must never read as "no drift": fail, and name the
    // comparison a maintainer can run by hand until the job can read it again.
    console.error(`::error::Could not read the live ${options.branch} rules, so drift was not checked: ${error.message}`);
    console.error(`Compare by hand: gh api repos/${options.repository}/rules/branches/${options.branch} --jq '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[]]' against ${options.expected}.`);
    process.exitCode = 1;
    return;
  }
  const missing = expected.filter(key => !live.includes(key)), extra = live.filter(key => !expected.includes(key));
  if (!missing.length && !extra.length) {
    console.log(`Live ${options.branch} required checks match ${options.expected}: ${expected.join(', ')}.`);
    return;
  }
  for (const key of missing) console.error(`::error::Missing required check on ${options.branch}: ${key} is committed in ${options.expected} but the live rules do not require it.`);
  for (const key of extra) console.error(`::error::Extra required check on ${options.branch}: ${key} is required by the live rules but not committed in ${options.expected}.`);
  console.error(`Ruleset drift on ${options.branch}: update the ruleset or ${options.expected} so they agree, in the same reviewed change.`);
  process.exitCode = 1;
}

main().catch(error => {
  console.error(`::error::Ruleset drift check failed: ${error.message}`);
  process.exitCode = 1;
});
