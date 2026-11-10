import '../../tests/isolate-git-env.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// #2216: the Nightly ruleset-drift job runs this command against the live
// GitHub API. Here a local server stands in for GitHub with responses shaped
// like GET /repos/{owner}/{repo}/rules/branches/{branch} as read on 2026-11-04.
const tool = fileURLToPath(new URL('./ruleset-drift.mjs', import.meta.url));

const committed = {
  schemaVersion: 1,
  branch: 'main',
  requiredStatusChecks: [
    { context: 'scanner-tests', integrationId: 15368 },
    { context: 'funsidething/memory-audit' },
    { context: 'funsidething/independent-review' },
    { context: 'funsidething/specialist-review' },
  ],
};
const source = { ruleset_source_type: 'Repository', ruleset_source: 'emerald-pham/funsidething', ruleset_id: 23880568 };
const statusRule = checks => ({ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: checks }, ...source });
const liveToday = [
  { type: 'deletion', ...source },
  { type: 'non_fast_forward', ...source },
  { type: 'pull_request', parameters: { required_approving_review_count: 0 }, ...source },
  statusRule([
    { context: 'scanner-tests', integration_id: 15368 },
    { context: 'funsidething/memory-audit' },
    { context: 'funsidething/independent-review' },
    { context: 'funsidething/specialist-review' },
  ]),
];

async function withGitHub(t, pages, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    const url = new URL(request.url, 'http://fixture');
    const page = Number(url.searchParams.get('page') || 1), entry = pages[page - 1];
    if (!entry) { response.writeHead(404).end('{"message":"Not Found"}'); return; }
    const { status = 200, body, next = false } = entry;
    const headers = { 'content-type': 'application/json' };
    if (next) headers.link = `<http://${request.headers.host}${url.pathname}?per_page=100&page=${page + 1}>; rel="next"`;
    response.writeHead(status, headers).end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = mkdtempSync(join(tmpdir(), 'chain-ruleset-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = join(root, 'required-status-checks.json');
  writeFileSync(expected, JSON.stringify(committed));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const result = await new Promise(resolve => execFile(process.execPath, [tool, '--repository', 'emerald-pham/funsidething', '--branch', 'main', '--expected', expected], {
    env: { ...process.env, GITHUB_API_URL: apiUrl, GITHUB_TOKEN: 'fixture-token' }, encoding: 'utf8', timeout: 30000,
  }, (error, stdout, stderr) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr })));
  return run({ ...result, requests });
}

test('ruleset drift passes for the committed set and names missing and extra checks on a mismatch', async t => {
  await t.test('the live rules match the committed set', t => withGitHub(t, [{ body: liveToday }], ({ status, stdout, stderr, requests }) => {
    assert.equal(status, 0, stderr);
    assert.match(stdout, /match/i);
    assert.equal(new URL(requests[0].url, 'http://fixture').pathname, '/repos/emerald-pham/funsidething/rules/branches/main', 'the check reads the rules that actually apply to main');
    assert.equal(requests[0].authorization, 'Bearer fixture-token', 'the check authenticates with the workflow token');
  }));

  await t.test('a removed and an added check are both named', t => withGitHub(t, [{ body: [liveToday[0], statusRule([
    { context: 'scanner-tests', integration_id: 15368 },
    { context: 'funsidething/memory-audit' },
    { context: 'funsidething/independent-review' },
    { context: 'lint' },
  ])] }], ({ status, stdout, stderr }) => {
    assert.notEqual(status, 0, 'drift must fail the nightly run');
    const output = stdout + stderr;
    assert.match(output, /missing[^\n]*funsidething\/specialist-review/i);
    assert.match(output, /extra[^\n]*\blint\b/i);
    assert.doesNotMatch(output, /missing[^\n]*funsidething\/memory-audit/i, 'checks that are still required are not reported');
  }));

  await t.test('scanner-tests losing its GitHub Actions app binding is drift', t => withGitHub(t, [{ body: [statusRule([
    { context: 'scanner-tests' },
    { context: 'funsidething/memory-audit' },
    { context: 'funsidething/independent-review' },
    { context: 'funsidething/specialist-review' },
  ])] }], ({ status, stdout, stderr }) => {
    assert.notEqual(status, 0, 'any source could then satisfy the required CI check');
    assert.match(stdout + stderr, /missing[^\n]*scanner-tests[^\n]*15368/i);
    assert.match(stdout + stderr, /extra[^\n]*scanner-tests/i);
  }));

  await t.test('a disabled ruleset leaves every committed check missing', t => withGitHub(t, [{ body: liveToday.slice(0, 3) }], ({ status, stdout, stderr }) => {
    assert.notEqual(status, 0);
    for (const context of ['scanner-tests', 'funsidething/memory-audit', 'funsidething/independent-review', 'funsidething/specialist-review'])
      assert.ok((stdout + stderr).includes(context), `missing check must be named: ${context}`);
  }));

  await t.test('checks from several rulesets and pages are combined', t => withGitHub(t, [
    { body: [statusRule([{ context: 'scanner-tests', integration_id: 15368 }, { context: 'funsidething/memory-audit' }])], next: true },
    { body: [statusRule([{ context: 'funsidething/memory-audit' }, { context: 'funsidething/independent-review' }, { context: 'funsidething/specialist-review' }])] },
  ], ({ status, stderr, requests }) => {
    assert.equal(status, 0, stderr);
    assert.equal(requests.length, 2, 'every page of rules is read');
  }));
});

test('ruleset drift fails visibly and names the manual comparison when the rules cannot be read', async t => {
  const unreadable = {
    'the token is refused': { status: 403, body: { message: 'Resource not accessible by integration' } },
    'the branch rules are not found': { status: 404, body: { message: 'Not Found' } },
    'the response is not JSON': { body: '<html>unicorn</html>' },
    'the response is not a rule list': { body: { message: 'unexpected shape' } },
  };
  for (const [name, page] of Object.entries(unreadable)) {
    await t.test(name, t => withGitHub(t, [page], ({ status, stdout, stderr }) => {
      assert.notEqual(status, 0, 'an unreadable ruleset must never count as no drift');
      assert.doesNotMatch(stdout, /match/i);
      assert.match(stderr, /could not read/i);
      assert.ok(stderr.includes('gh api repos/emerald-pham/funsidething/rules/branches/main'), 'the failure names the manual comparison to run instead');
    }));
  }
});
