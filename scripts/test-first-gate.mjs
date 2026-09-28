import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const appFiles=new Set([
  'index.html','sw.js','manifest.webmanifest','icon.svg','location.js','stars.js',
  'landscape.css','landscape.js','landscape-core.js','landscape-config.js',
  'landscape-geometry.js','landscape-mood.js','landscape-appearance.js',
  'landscape-riders.js','landscape-seasonal.js','landscape-skywriter.js','landscape-winter.js',
]);
const riskFiles=new Set(['index.html','sw.js','location.js','landscape-core.js','landscape-geometry.js','landscape-mood.js']);
const isAppFile=file=>appFiles.has(file)||/^icon-.*\.png$/.test(file);

export function validateTestFirst(changedFiles,addedTestLines){
  const edited=changedFiles.filter(isAppFile);
  if(!edited.length)return [];
  const errors=[];
  if(!changedFiles.includes('tests.js')) errors.push(`App files changed (${edited.join(', ')}) without tests.js in the diff.`);
  if(edited.some(file=>riskFiles.has(file)) && !addedTestLines.some(line=>/^\+\s*test\s*\(\s*['"]RISK\b/.test(line)))
    errors.push(`A high-risk app file changed (${edited.filter(file=>riskFiles.has(file)).join(', ')}) without a new RISK test in tests.js.`);
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
    process.stdout.write('Initial branch push: no previous commit to compare.\n');
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
