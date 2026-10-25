import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export function sourceButtonTemplates(source){
 const counts={};
 for(const match of source.matchAll(/<(?:button|summary)\b[^>]*>|createElement\(\s*['"](?:button|summary)['"]\s*\)/g)){const key=digest(match[0]);counts[key]=(counts[key]||0)+1;}
 return Object.fromEntries(Object.entries(counts).sort(([a],[b])=>a.localeCompare(b)));
}
export function verifyButtonInventorySource(source,inventory){
 assert.deepEqual(sourceButtonTemplates(source),inventory.sourceTemplates,'Source button templates differ from reviewed native inventory');return true;
}
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function verifyButtonSafetyReport(report,{inventory,inventorySha256,candidateCommit,candidateTree,engine}={}){
 assert.equal(report.schemaVersion,1,'Known button report schema');
 assert.equal(report.kind,'button-safety','Native button report kind');
 assert.ok(['chromium','webkit'].includes(report.engine),'Named native engine required');
 assert.equal(report.scope,undefined,'Focused diagnostics cannot qualify complete button coverage');
 assert.equal(report.status,'passed','Native button run must pass; unavailable engine cannot pass');
 for(const [key,expected]of Object.entries({candidateCommit,candidateTree,engine,inventorySha256}))if(expected!==undefined)assert.equal(report[key],expected,'Button report '+key+' mismatch');
 for(const key of ['candidateCommit','candidateTree'])assert.match(report[key]||'',/^[a-f0-9]{40}$/,'Exact '+key+' required');
 assert.ok(inventory,'Independent button inventory required');
 const actions=inventory.requiredActions;
 assert.ok(Array.isArray(actions)&&actions.length>0,'Nonempty independent button inventory required');
 assert.equal(new Set(actions).size,actions.length,'Duplicate expected button action');
 assert.deepEqual(report.requiredActions,actions,'Report cannot waive required actions');
 for(const action of actions){
  const rows=(report.outcomes||[]).filter(row=>row.action===action);
  assert.equal(rows.length,1,'Missing required button action: '+action);
  const row=rows[0];assert.equal(row.status,'passed','Button action must execute successfully: '+action);
  assert.ok(row.events?.includes('click')||row.events?.includes('change')||row.events?.includes('submit'),'Real consumer event required: '+action);
  assert.ok(Number.isSafeInteger(row.assertions)&&row.assertions>0,'Independent outcome assertion required: '+action);
  assert.equal(row.responsive,true,'Button action responsiveness required: '+action);
 }
 assert.equal(report.outcomes.length,actions.length,'Unexpected or duplicate native outcome');
 const scenarios=inventory?.requiredScenarios;
 if(scenarios){
  assert.ok(Array.isArray(scenarios)&&scenarios.length>0,'Nonempty independent state scenario inventory required');
  assert.equal(new Set(scenarios).size,scenarios.length,'Duplicate expected native state scenario');
  assert.deepEqual(report.requiredScenarios,scenarios,'Report cannot waive required state scenarios');
  for(const name of scenarios){
   const rows=(report.scenarios||[]).filter(row=>row.name===name);
   assert.equal(rows.length,1,'Missing or duplicate required native state scenario: '+name);
   assert.equal(rows[0].status,'passed','Native state scenario must execute successfully: '+name);
  }
  assert.equal(report.scenarios.length,scenarios.length,'Unexpected native state scenario');
 }

 assert.ok(Array.isArray(report.observedActions),'Observed native button inventory required');
 for(const action of report.observedActions)assert.ok(actions.includes(action),'New untested button action: '+action);
 assert.deepEqual(report.errors,[],'Native lifecycle or error detector failed');
 for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(report.cleanup?.[key],true,'Button runtime cleanup required: '+key);
 return report;
}
