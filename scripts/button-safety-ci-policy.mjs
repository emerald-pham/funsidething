import assert from 'node:assert/strict';
// Routing policy names describe source/checkout semantics; they are not raw
// GitHub event names. Keep both through the native and capped child boundary.
export function hostedButtonPolicy(env=process.env){
 assert.equal(env.CI,'true','Hosted button launch requires explicit CI');
 const eventPolicy=env.CHAIN_TEST_EVENT_POLICY,eventName=env.GITHUB_EVENT_NAME,eventRef=env.GITHUB_REF;
 const events={'canonical-pr-merge-v1':'pull_request','outgoing-branch-push-v1':'push','exact-main-push-v1':'push',pull_request:'pull_request',push:'push'};
 assert.ok(Object.hasOwn(events,eventPolicy||''),'Explicit supported hosted button policy required');
 assert.equal(eventName,events[eventPolicy],'Raw GitHub event must match routed button policy');
 assert.match(eventRef||'',eventName==='pull_request'?/^refs\/pull\/[1-9][0-9]*\/merge$/:/^refs\/heads\/.+/,'Raw GitHub ref must match its event');
 if(eventPolicy==='exact-main-push-v1')assert.equal(eventRef,'refs/heads/main');
 if(eventPolicy==='outgoing-branch-push-v1')assert.notEqual(eventRef,'refs/heads/main');
 return{eventPolicy,eventName,eventRef};
}
