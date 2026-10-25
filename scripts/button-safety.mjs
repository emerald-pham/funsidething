#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
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
 const actions=inventory?.requiredActions||report.requiredActions;
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
 assert.ok(Array.isArray(report.observedActions),'Observed native button inventory required');
 for(const action of report.observedActions)assert.ok(actions.includes(action),'New untested button action: '+action);
 assert.deepEqual(report.errors,[],'Native lifecycle or error detector failed');
 for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(report.cleanup?.[key],true,'Button runtime cleanup required: '+key);
 return report;
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  if(args.includes('--verify-report')){
   const inventory=args.includes('--inventory')?fs.readFileSync(value('--inventory')):null;
   verifyButtonSafetyReport(JSON.parse(fs.readFileSync(value('--verify-report'),'utf8')),{...(inventory?{inventory:JSON.parse(inventory),inventorySha256:digest(inventory)}:{})});
   process.stdout.write('Button safety report verified.\n');
  }else if(args.includes('--check-inventory')){verifyButtonInventorySource(fs.readFileSync(value('--source'),'utf8'),JSON.parse(fs.readFileSync(value('--inventory'),'utf8')));process.stdout.write('Source button inventory verified.\n');}else if(args.includes('--run')){const {runButtonSafety}=await import('./button-safety-native.mjs');const result=await runButtonSafety({repo:process.cwd(),engine:value('--engine'),outputDir:value('--output-dir'),port:Number(value('--port')||0),control:args.includes('--control')?value('--control'):null,probe:args.includes('--probe'),scenarioFilter:args.includes('--scenario')?value('--scenario'):null});process.stdout.write('Button evidence: '+result.reportPath+'\n');if(!args.includes('--probe')&&!args.includes('--scenario')){const bytes=fs.readFileSync('scripts/button-safety-inventory.json');verifyButtonSafetyReport(result.report,{inventory:JSON.parse(bytes),inventorySha256:digest(bytes)});}}else throw Error('Choose --verify-report or --run');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
