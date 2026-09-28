import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const runtimeFilePattern=/\.(?:html|js|mjs|cjs|jsx|ts|tsx|css|scss|webmanifest|svg|png|jpe?g|webp|avif)$/i;
const nonAppDirectories=new Set(['.git','.github','.claude','audits','node_modules','scripts']);
const processFiles=new Set([
  'scripts/test-first-gate.mjs',
  '.claude/hooks/test-first-guard.sh',
]);
const isProcessFile=file=>processFiles.has(file)||/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file);
const isAppFile=file=>{
  if(file==='tests.js')return false;
  if(file==='firestore.rules')return true;
  if(file.split('/').some(segment=>nonAppDirectories.has(segment)))return false;
  return runtimeFilePattern.test(file);
};
// Browser code and the offline/security shell all carry state, eligibility,
// layout, timing, or paint behavior. New runtime modules inherit the RISK bar
// automatically instead of waiting for a hand-maintained filename list.
const isHighRiskAppFile=file=>file==='firestore.rules'||isAppFile(file)&&/\.(?:html|js|mjs|cjs|jsx|ts|tsx|webmanifest)$/i.test(file);
const hasAddedRiskTest=lines=>lines.some(line=>/^\+\s*test\s*\(\s*['"]RISK\b/.test(line));

export function validateTestFirst(changedFiles,addedTestLines){
  const edited=changedFiles.filter(isAppFile);
  const enforcementEdits=changedFiles.filter(isProcessFile);
  if(!edited.length&&!enforcementEdits.length)return [];
  const errors=[];
  if(!changedFiles.includes('tests.js')){
    if(edited.length)errors.push(`App files changed (${edited.join(', ')}) without tests.js in the diff.`);
    if(enforcementEdits.length)errors.push(`Test-first enforcement changed (${enforcementEdits.join(', ')}) without tests.js process coverage in the diff.`);
  }
  const highRisk=[...edited.filter(isHighRiskAppFile),...enforcementEdits];
  if(highRisk.length&&!hasAddedRiskTest(addedTestLines))
    errors.push(`A high-risk app or enforcement file changed (${highRisk.join(', ')}) without a new RISK test in tests.js.`);
  return errors;
}

// Every executable test change needs a purpose and red evidence. Exempting
// appended code allowed process.exit(0) to bypass the suite; a uniform rule
// avoids pretending to distinguish safe additions without a JavaScript parser.
const protectedTestLines=lines=>{
  const protectedLines=[];let cursor=null;
  for(const line of lines){
    const hunk=line.match(/^@@ -(\d+)(?:,(\d+))? \+/);
    if(hunk){cursor=Number(hunk[1])+(hunk[2]==='0'?1:0);continue;}
    if(line.startsWith('---')||line.startsWith('+++'))continue;
    const content=line.slice(1).trim(),meaningful=content&&!content.startsWith('//');
    if(line.startsWith('-')){if(meaningful)protectedLines.push(`${cursor??''}:-${content}`);if(cursor!==null)cursor++;}
    else if(line.startsWith('+')){
      if(meaningful)protectedLines.push(`${cursor??''}:+${content}`);
    }else if(line.startsWith(' ')&&cursor!==null)cursor++;
  }
  return protectedLines;
};
export function protectedTestFingerprint(lines){
  return createHash('sha256').update(protectedTestLines(lines).join('\n')).digest('hex');
}
export function validateRegressionChanges(lines,records){
  if(!protectedTestLines(lines).length)return [];
  const record=Array.isArray(records)&&records.find(entry=>entry?.testChangesSha256===protectedTestFingerprint(lines));
  if(!record)return ['Existing tests were changed or removed without an exact-diff rationale in TEST_CHANGE_RATIONALES.json.'];
  const errors=[],substantive=value=>typeof value==='string'&&value.trim().length>=20;
  for(const field of ['reason','previousBehavior','intendedBehavior'])
    if(!substantive(record[field]))errors.push(`Regression rationale needs a specific ${field}.`);
  if(!Array.isArray(record.preservedCoverage)||!record.preservedCoverage.length||!record.preservedCoverage.every(substantive))
    errors.push('Regression rationale must name the feature boundaries whose coverage is preserved.');
  if(!substantive(record.redEvidence?.command)||!substantive(record.redEvidence?.failure))
    errors.push('Regression rationale must record the red-test command and observed failure.');
  const added=lines.filter(line=>line.startsWith('+')&&!line.startsWith('+++')).join('\n');
  if(!Array.isArray(record.replacementTests)||!record.replacementTests.length||!record.replacementTests.every(name=>
    typeof name==='string'&&name.length>10&&(added.includes("test('"+name+"'")||added.includes('test("'+name+'"'))))
    errors.push('Regression rationale must name replacement tests added or updated in this diff.');
  return errors;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const base=process.argv[2];
  if(!base || !/^[0-9a-f]{40}$/.test(base)){
    process.stderr.write('Pass the 40-character base commit SHA.\n');process.exitCode=2;
  }else if(/^0+$/.test(base)){
    process.stderr.write('A zero base SHA has no commit to compare. Resolve the base against the default branch before running the gate.\n');process.exitCode=2;
  }else{
    try{
      const diff=(...args)=>execFileSync('git',['diff',...args,`${base}...HEAD`],{encoding:'utf8'});
      const changed=diff('--name-only','--diff-filter=ACMRTD').trim().split('\n').filter(Boolean);
      const testDiff=execFileSync('git',['diff','--unified=0',`${base}...HEAD`,'--','tests.js'],{encoding:'utf8'}).split('\n');
      const records=fs.existsSync('TEST_CHANGE_RATIONALES.json')?JSON.parse(fs.readFileSync('TEST_CHANGE_RATIONALES.json','utf8')):[];
      const errors=[...validateTestFirst(changed,testDiff),...validateRegressionChanges(testDiff,records)];
      if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}
      else process.stdout.write('Test-first diff gate passed.\n');
    }catch(error){process.stderr.write(`Could not compare ${base} to HEAD: ${error.message}\n`);process.exitCode=2;}
  }
}
