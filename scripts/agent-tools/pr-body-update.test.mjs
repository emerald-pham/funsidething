import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const updater = fileURLToPath(new URL('./pr-body-update.mjs', import.meta.url));
const fixtureGh = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const statePath = process.env.GH_FIXTURE_STATE;
const callPath = process.env.GH_FIXTURE_CALLS;
const scenario = process.env.GH_FIXTURE_SCENARIO ?? 'success';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const previousCalls = readFileSync(callPath, 'utf8').split('\\n').filter(Boolean).map((line) => JSON.parse(line));
const patchAttempt = previousCalls.filter((call) => call.args[0] === 'api' && call.args.includes('--method') && call.args[call.args.indexOf('--method') + 1] === 'PATCH').length + 1;
const getAttempt = previousCalls.filter((call) => call.args[0] === 'api' && !call.args.includes('--method')).length + 1;
appendFileSync(callPath, JSON.stringify({ args, input, godebug: process.env.GODEBUG ?? null }) + '\\n');

if (args[0] !== 'api') {
  process.stderr.write('GraphQL: Project cards v2 is deprecated and no longer supported by gh pr edit\\n');
  process.exit(1);
}
const endpoint = args[1];
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
if (method === 'PATCH' && ['transient-before-write', 'transient-then-lost-response-on-retry'].includes(scenario) && patchAttempt === 1) {
  process.stderr.write('HTTP 503: Service Unavailable\\n');
  process.exit(1);
}
if (method === 'PATCH' && scenario === 'transient-then-lost-response-on-retry' && patchAttempt === 2) {
  state.pull.body = JSON.parse(input).body;
  writeFileSync(statePath, JSON.stringify(state) + '\\n', 'utf8');
  process.stderr.write('request failed: connection reset by peer\\n');
  process.exit(1);
}
if (method === 'PATCH' && scenario === 'always-transient-before-write') {
  process.stderr.write('HTTP 503: Service Unavailable\\n');
  process.exit(1);
}
if (method === 'PATCH' && scenario === 'http2-before-write' && patchAttempt === 1) {
  process.stderr.write('Post https://api.github.com: unexpected EOF\\n');
  process.exit(1);
}
if (method === 'PATCH' && ['ignore-replacement', 'ignore-then-final-readback-failure'].includes(scenario)) {
  process.stdout.write(JSON.stringify(state.pull));
  process.exit(0);
}
if (method === 'GET' && scenario === 'ignore-then-final-readback-failure' && getAttempt === 2) {
  process.stderr.write('HTTP 503: Service Unavailable\\n');
  process.exit(1);
}
if (method === 'PATCH' && ['lost-response-after-write', 'readback-failure-after-write'].includes(scenario) && patchAttempt === 1) {
  state.pull.body = JSON.parse(input).body;
  writeFileSync(statePath, JSON.stringify(state) + '\\n', 'utf8');
  process.stderr.write('request failed: connection reset by peer\\n');
  process.exit(1);
}
if (method === 'GET' && (scenario === 'readback-failure' || scenario === 'readback-failure-after-write')) {
  process.stderr.write('HTTP 503: Service Unavailable\\n');
  process.exit(1);
}
if (method === 'PATCH') {
  const payload = JSON.parse(input);
  state.pull.body = payload.body;
  writeFileSync(statePath, JSON.stringify(state) + '\\n', 'utf8');
}
process.stdout.write(JSON.stringify(state.pull));
`;

function makeFixture({ initialBody = 'Old PR body', scenario = 'success' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pr-body-update-'));
  const bin = join(root, 'bin');
  const input = join(root, 'replacement body.md');
  const statePath = join(root, 'state.json');
  const callsPath = join(root, 'calls.jsonl');
  const pull = {
    number: 42,
    body: initialBody,
    title: 'Keep this title',
    state: 'open',
    base: { ref: 'main', repo: { full_name: 'acme/widgets' } },
    head: { ref: 'feature', repo: { full_name: 'contributor/widgets' } },
    labels: [{ name: 'ready' }],
    milestone: { number: 7, title: 'Checkpoint' },
  };
  const state = { pull, issueComments: [], createdPullRequests: [] };
  const body = JSON.stringify(state);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), fixtureGh, { mode: 0o700 });
  chmodSync(join(bin, 'gh'), 0o700);
  writeFileSync(statePath, `${body}\n`, 'utf8');
  writeFileSync(callsPath, '', 'utf8');

  return {
    root,
    input,
    statePath,
    callsPath,
    pull,
    writeBody(value) { writeFileSync(input, value, 'utf8'); },
    writeBodyBytes(value) { writeFileSync(input, value); },
    readState() { return JSON.parse(readFileSync(statePath, 'utf8')); },
    readCalls() {
      return readFileSync(callsPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
    run(args = ['--pr', 'acme/widgets#42', '--body-file', input], envOverrides = {}) {
      return spawnSync(process.execPath, [updater, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
          GH_FIXTURE_STATE: statePath,
          GH_FIXTURE_CALLS: callsPath,
          GH_FIXTURE_SCENARIO: scenario,
          GODEBUG: '',
          ...envOverrides,
        },
      });
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

test('replaces only the identified PR body with exact UTF-8 text through the REST API', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const replacement = 'Résumé — 東京 🌱\n\nSecond line with $HOME and $(printf no-shell)\n';
  fixture.writeBody(replacement);

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Updated acme\/widgets#42 body/);
  const calls = fixture.readCalls();
  assert.equal(calls.length, 1, 'a successful update has one API write and no extra GitHub action');
  assert.deepEqual(calls[0].args, ['api', 'repos/acme/widgets/pulls/42', '--method', 'PATCH', '--input', '-']);
  assert.equal(calls.some((call) => call.args[0] === 'pr'), false, 'the GraphQL-backed gh pr edit compatibility failure is bypassed');
  assert.deepEqual(JSON.parse(calls[0].input), { body: replacement });
  assert.equal(calls[0].input.includes(replacement), false, 'the complete body is supplied as structured stdin, not a CLI argument');
  const after = fixture.readState();
  assert.equal(after.pull.body, replacement);
  assert.deepEqual({ ...after.pull, body: fixture.pull.body }, fixture.pull, 'title, state, base, head, labels and milestone survive unchanged');
  assert.deepEqual(after.issueComments, [], 'the updater does not create an external message');
  assert.deepEqual(after.createdPullRequests, [], 'the updater does not create another pull request');
});

test('retries a transient REST failure once after confirming the requested body is absent', (t) => {
  const fixture = makeFixture({ scenario: 'transient-before-write' });
  t.after(() => fixture.cleanup());
  const replacement = 'New body after a temporary service error';
  fixture.writeBody(replacement);

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Updated acme\/widgets#42 body/);
  const calls = fixture.readCalls();
  const methods = calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET');
  assert.deepEqual(methods, ['PATCH', 'GET', 'PATCH']);
  assert.equal(fixture.readState().pull.body, replacement);
  assert.equal(fixture.readState().pull.title, fixture.pull.title);
});

test('uses HTTP/2 fallback only for child commands after a matching transport failure', (t) => {
  const fixture = makeFixture({ scenario: 'http2-before-write' });
  t.after(() => fixture.cleanup());
  fixture.writeBody('Retry body');
  const inheritedDebug = process.env.GODEBUG;

  const result = fixture.run(undefined, { GODEBUG: 'netdns=go,http2client=1' });

  assert.equal(result.status, 0, result.stderr);
  const calls = fixture.readCalls();
  const methods = calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET');
  assert.deepEqual(methods, ['PATCH', 'GET', 'PATCH']);
  assert.equal(calls[0].godebug, 'netdns=go,http2client=1');
  assert.equal(calls[1].godebug, 'netdns=go,http2client=0');
  assert.equal(calls[2].godebug, 'netdns=go,http2client=0');
  assert.equal(process.env.GODEBUG, inheritedDebug, 'fallback environment does not mutate the caller');
});

test('stops after two failed writes and a failed verification read without issuing a retry', (t) => {
  const fixture = makeFixture({ scenario: 'readback-failure-after-write' });
  t.after(() => fixture.cleanup());
  fixture.writeBody('Body whose response was lost');

  const result = fixture.run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Readback failed, so no retry was sent/);
  const calls = fixture.readCalls();
  assert.deepEqual(calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET'), ['PATCH', 'GET']);
  assert.equal(calls.filter((call) => call.args.includes('--method')).length, 1);
});

test('bounds retries at one when the replacement body remains absent', (t) => {
  const fixture = makeFixture({ scenario: 'always-transient-before-write' });
  t.after(() => fixture.cleanup());
  fixture.writeBody('Retry only once');

  const result = fixture.run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stopping after two writes/);
  const calls = fixture.readCalls();
  assert.deepEqual(calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET'), ['PATCH', 'GET', 'PATCH', 'GET']);
  assert.equal(calls.filter((call) => call.args.includes('--method')).length, 2);
  assert.equal(fixture.readState().pull.body, fixture.pull.body);
});

test('reports a successful API response that never stores the exact replacement', (t) => {
  const fixture = makeFixture({ scenario: 'ignore-replacement' });
  t.after(() => fixture.cleanup());
  fixture.writeBody('Replacement not accepted by the fixture API');

  const result = fixture.run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mismatched Pull Request response/);
  assert.match(result.stderr, /Readback confirmed that the requested body is not present/);
  assert.doesNotMatch(result.stderr, /exit status 0/, 'a successful but mismatched response is not described as a command failure');
  const calls = fixture.readCalls();
  assert.deepEqual(calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET'), ['PATCH', 'GET', 'PATCH', 'GET']);
  assert.equal(calls.filter((call) => call.args.includes('--method')).length, 2);
  assert.equal(fixture.readState().pull.body, fixture.pull.body);
});

test('describes a failed final readback after an unverified successful retry accurately', (t) => {
  const fixture = makeFixture({ scenario: 'ignore-then-final-readback-failure' });
  t.after(() => fixture.cleanup());
  fixture.writeBody('Replacement with unavailable final verification');

  const result = fixture.run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mismatched Pull Request response/);
  assert.match(result.stderr, /Final readback failed: gh api readback failed: HTTP 503/);
  assert.doesNotMatch(result.stderr, /exit status 0/, 'the successful PATCH response is reported as a mismatch, not a failed command');
  const calls = fixture.readCalls();
  assert.deepEqual(calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET'), ['PATCH', 'GET', 'PATCH', 'GET']);
  assert.equal(calls.filter((call) => call.args.includes('--method')).length, 2);
});

test('rejects unidentified PRs and invalid UTF-8 bodies before contacting GitHub', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  fixture.writeBodyBytes(Buffer.from([0xc3, 0x28]));

  const missingPr = fixture.run(['--body-file', fixture.input]);
  const malformedPr = fixture.run(['--pr', 'acme/widgets/pulls/42', '--body-file', fixture.input]);
  const invalidUtf8 = fixture.run();

  assert.equal(missingPr.status, 1);
  assert.match(missingPr.stderr, /Required option: --pr/);
  assert.equal(malformedPr.status, 1);
  assert.match(malformedPr.stderr, /Invalid PR identifier/);
  assert.equal(invalidUtf8.status, 1);
  assert.match(invalidUtf8.stderr, /not valid UTF-8/);
  assert.deepEqual(fixture.readCalls(), [], 'invalid input cannot mutate or even read a PR');
  assert.equal(fixture.readState().pull.body, fixture.pull.body);
});

test('verifies an uncertain write before retrying and avoids a duplicate body mutation', (t) => {
  const fixture = makeFixture({ scenario: 'lost-response-after-write' });
  t.after(() => fixture.cleanup());
  const replacement = 'Checkpoint body — π\nSecond line';
  fixture.writeBody(replacement);

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/i);
  assert.match(result.stdout, /no retry was needed/i);
  const calls = fixture.readCalls();
  const methods = calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET');
  assert.deepEqual(methods, ['PATCH', 'GET'], 'readback follows the uncertain write and precedes any retry');
  assert.equal(fixture.readState().pull.body, replacement);
  assert.deepEqual(fixture.readState().issueComments, []);
  assert.deepEqual(fixture.readState().createdPullRequests, []);
});

test('reports exact readback after the single retry of an uncertain update', (t) => {
  const fixture = makeFixture({ scenario: 'transient-then-lost-response-on-retry' });
  t.after(() => fixture.cleanup());
  const replacement = 'Body applied during the one retry';
  fixture.writeBody(replacement);

  const result = fixture.run();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified acme\/widgets#42 body after retrying an uncertain update/);
  const calls = fixture.readCalls();
  assert.deepEqual(calls.map((call) => call.args.includes('--method') ? call.args[call.args.indexOf('--method') + 1] : 'GET'), ['PATCH', 'GET', 'PATCH', 'GET']);
  assert.equal(calls.filter((call) => call.args.includes('--method')).length, 2);
  assert.equal(fixture.readState().pull.body, replacement);
  assert.deepEqual(fixture.readState().issueComments, []);
  assert.deepEqual(fixture.readState().createdPullRequests, []);
});
