import assert from "node:assert/strict";
import { hostedButtonPolicy as canonicalHostedPolicy } from "../button-safety-ci-policy.mjs";
// Ordinary push/PR semantics delegate byte-for-byte to the frozen policy.
// The new nonqualifying entrypoint receives this bounded descendant context
// only after the parent verifies the signed permit and atomic GitHub claim.
// Environment replacement by an administrator remains inside the writer boundary.
export function hostedButtonPolicy(env = process.env) {
  if (env.CHAIN_TEST_EVENT_POLICY !== "diagnostic-workflow-dispatch-v1")
    return canonicalHostedPolicy(env);
  assert.equal(env.CI, "true");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.match(
    env.GITHUB_REF || "",
    /^refs\/heads\/diagnose\/[A-Za-z0-9._/-]+$/,
  );
  assert.match(env.CHAIN_DIAGNOSTIC_CLAIM || "", /^[a-f0-9]{40}$/);
  assert.match(env.CHAIN_TEST_SOURCE_SHA || "", /^[a-f0-9]{40}$/);
  assert.equal(env.CHAIN_DIAGNOSTIC_SOURCE, env.CHAIN_TEST_SOURCE_SHA);
  assert.match(env.GITHUB_RUN_ID || "", /^[1-9][0-9]*$/);
  assert.equal(env.GITHUB_RUN_ATTEMPT, "1");
  assert.equal(
    env.CHAIN_DIAGNOSTIC_AUTHORIZATION,
    [
      env.CHAIN_TEST_SOURCE_SHA,
      env.GITHUB_RUN_ID,
      "1",
      env.CHAIN_DIAGNOSTIC_CLAIM,
    ].join(":"),
  );
  return {
    eventPolicy: env.CHAIN_TEST_EVENT_POLICY,
    eventName: env.GITHUB_EVENT_NAME,
    eventRef: env.GITHUB_REF,
    nonqualifying: true,
    source: env.CHAIN_TEST_SOURCE_SHA,
    claim: env.CHAIN_DIAGNOSTIC_CLAIM,
    runId: env.GITHUB_RUN_ID,
    runAttempt: 1,
  };
}
