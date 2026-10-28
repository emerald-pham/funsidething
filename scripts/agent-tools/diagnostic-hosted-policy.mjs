import { hostedButtonPolicy as canonicalHostedPolicy } from "../button-safety-ci-policy.mjs";
import { diagnosticDescendantContext } from "./checkpoint-progress.mjs";
// The reviewed dispatch adapter preserves actual main workflow metadata and a
// distinct signed-permit source ref. Ordinary policy delegates unchanged.
export function hostedButtonPolicy(env = process.env) {
  if (env.CHAIN_TEST_EVENT_POLICY !== "diagnostic-workflow-dispatch-v1")
    return canonicalHostedPolicy(env);
  return diagnosticDescendantContext(env);
}
