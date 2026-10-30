#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,verifyButtonSafetyReport,verifyButtonInventorySource} from './button-safety-contract.mjs';
export {digest,verifyButtonSafetyReport,verifyButtonInventorySource,sourceButtonTemplates} from './button-safety-contract.mjs';
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1],profile=args.includes('--profile')?value('--profile'):undefined;
  const startupCapture=args.includes('--startup-capture')?value('--startup-capture'):null;
  if(args.includes('--startup-capture')&&startupCapture!=='jpeg')throw Error('Startup capture selection requires explicit jpeg mode');
  if(args.includes('--verify-report')){
   const inventory=args.includes('--inventory')?fs.readFileSync(value('--inventory')):null;
   verifyButtonSafetyReport(JSON.parse(fs.readFileSync(value('--verify-report'),'utf8')),{...(inventory?{inventory:JSON.parse(inventory),inventorySha256:digest(inventory)}:{}),...(profile===undefined?{}:{expectedProfile:profile})});
   process.stdout.write('Button safety report verified.\n');
  }else if(args.includes('--check-inventory')){verifyButtonInventorySource(fs.readFileSync(value('--source'),'utf8'),JSON.parse(fs.readFileSync(value('--inventory'),'utf8')));process.stdout.write('Source button inventory verified.\n');}else if(args.includes('--run')){const {runButtonSafety}=await import('./button-safety-native.mjs');const mobileYesMotion=args.includes('--mobile-yes')?(value('--motion')||'normal'):null;const selectedProfile=mobileYesMotion?'workload-diagnostic':profile??'ordinary';const result=await runButtonSafety({repo:process.cwd(),engine:value('--engine'),outputDir:value('--output-dir'),port:Number(value('--port')||0),profile,control:args.includes('--control')?value('--control'):null,probe:args.includes('--probe'),scenarioFilter:args.includes('--scenario')?value('--scenario'):null,mobileYesMotion,startupOpening:args.includes('--startup-opening')?{sourceCommit:value('--source-commit'),raw:fs.readFileSync(value('--fixture-file'),'utf8')}:null,startupCapture});process.stdout.write('Button evidence: '+result.reportPath+'\n');if(!args.includes('--probe')&&!args.includes('--scenario')&&!args.includes('--mobile-yes')&&!args.includes('--startup-opening')){const bytes=fs.readFileSync('scripts/button-safety-inventory.json');verifyButtonSafetyReport(result.report,{inventory:JSON.parse(bytes),inventorySha256:digest(bytes),expectedProfile:selectedProfile});}}else throw Error('Choose --verify-report or --run');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
