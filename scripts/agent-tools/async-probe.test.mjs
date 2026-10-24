import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { AsyncProbeTimeoutError, waitForTruthyProbe } from './async-probe.mjs';

test('async probe awaits false-to-true reads and bounds false or hanging reads', async t => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  await page.goto('about:blank');
  await page.evaluate(() => { window.probeCalls = 0; });
  const value = await waitForTruthyProbe(
    () => page.evaluate(async () => ++window.probeCalls >= 3),
    { timeoutMs: 2_000, pollIntervalMs: 10 },
  );
  assert.equal(value, true, 'resolved async truth must be returned');
  assert.equal(await page.evaluate(() => window.probeCalls), 3, 'false results are polled again');

  await page.evaluate(() => { window.probeCalls = 0; });
  const falseStarted = performance.now();
  await assert.rejects(
    waitForTruthyProbe(() => page.evaluate(async () => { ++window.probeCalls; return false; }),
      { timeoutMs: 300, pollIntervalMs: 10 }),
    AsyncProbeTimeoutError,
  );
  const falseElapsed = performance.now() - falseStarted;
  assert.ok(await page.evaluate(() => window.probeCalls) > 1, 'false results remain under the same polling deadline');
  assert.ok(falseElapsed >= 250 && falseElapsed < 1_500, `single false-probe deadline took ${falseElapsed}ms`);

  const hangingStarted = performance.now();
  await assert.rejects(
    waitForTruthyProbe(() => page.evaluate(() => new Promise(() => {})),
      { timeoutMs: 300, pollIntervalMs: 10 }),
    AsyncProbeTimeoutError,
  );
  const hangingElapsed = performance.now() - hangingStarted;
  assert.ok(hangingElapsed >= 250 && hangingElapsed < 1_500, `hanging read deadline took ${hangingElapsed}ms`);
});

test('async probe rejects missing or nonpositive bounds before invoking the reader', async () => {
  let calls = 0;
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 10, pollIntervalMs: 0 }]) {
    await assert.rejects(waitForTruthyProbe(() => { calls++; return true; }, options), TypeError);
  }
  assert.equal(calls, 0, 'invalid limits do not start the probe');
});
