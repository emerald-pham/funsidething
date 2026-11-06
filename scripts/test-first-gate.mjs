import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const runtimeFilePattern=/\.(?:html|js|mjs|cjs|jsx|ts|tsx|css|scss|webmanifest|svg|png|jpe?g|webp|avif)$/i;
const nonAppDirectories=new Set(['.git','.github','.claude','audits','node_modules','scripts']);
const processFiles=new Set([
  'scripts/test-first-gate.mjs',
  'scripts/backward-compatibility.mjs',
  'scripts/release-evidence.mjs',
  'scripts/install-release-hook.mjs',
  'scripts/test-groups.mjs',
  'scripts/agent-tools/test-groups.test.mjs',
  '.claude/hooks/test-first-guard.sh',
]);
const isProcessFile=file=>processFiles.has(file)||/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file);
// The test surface is the per-area tests/ directory (#2213). The edit hook's
// tests/* case mirrors this predicate (a shell hook cannot import it), so keep
// the two in sync. A root tests.js is not a test file any more: npm test and
// the group runner stopped running it, so a test written there protects nothing.
const isTestFile=file=>file.startsWith('tests/');
const LEGACY_TEST_FILE='tests.js';
const isAppFile=file=>{
  if(isTestFile(file))return false;
  if(file==='firestore.rules')return true;
  if(file.split('/').some(segment=>nonAppDirectories.has(segment)))return false;
  return runtimeFilePattern.test(file);
};
// A new RISK test marks real risk (#2233): saved data and sync (the device and
// cloud stores), the offline shell (pages, worker, manifest, release delivery),
// and the rules. Scenery, location and other modules still need a direct test;
// requiring RISK for every runtime file made the label meaningless and made
// most commits hand-edit the RISK map.
const highRiskAppFile=/(?:^|\/)(?:[^/]+\.html?|sw\.js|[^/]+\.webmanifest|device-store[^/]*\.m?js|cloud-store[^/]*\.m?js|app-release\.js)$/i;
const isHighRiskAppFile=file=>file==='firestore.rules'||isAppFile(file)&&highRiskAppFile.test(file);
const hasAddedRiskTest=lines=>lines.some(line=>/^\+\s*test\s*\(\s*['"]RISK\b/.test(line));
const hasAddedProcessRiskTest=lines=>lines.some(line=>/^\+\s*test\s*\(\s*['"]RISK (?:test-first gate|regression gate|test inventory|repository process)\b/.test(line));

// deletedFiles lets the split itself through: against a base from before
// #2213, the diff deletes tests.js, and those deleted lines stay protected by
// the rationale check below. Adding or editing a root tests.js is rejected.
export function validateTestFirst(changedFiles,addedTestLines,deletedFiles=[]){
  const errors=[];
  if(changedFiles.includes(LEGACY_TEST_FILE)&&!deletedFiles.includes(LEGACY_TEST_FILE))
    errors.push('A root tests.js was added or changed, but tests now live in the per-area files under tests/ and nothing runs tests.js. Move the change into the area file of its group as the porting note in docs/agents/test-groups.md describes.');
  const edited=changedFiles.filter(isAppFile);
  const enforcementEdits=changedFiles.filter(isProcessFile);
  if(!edited.length&&!enforcementEdits.length)return errors;
  if(!changedFiles.some(isTestFile)){
    if(edited.length)errors.push(`App files changed (${edited.join(', ')}) without a tests/ file in the diff.`);
    if(enforcementEdits.length)errors.push(`Test-first enforcement changed (${enforcementEdits.join(', ')}) without tests/ process coverage in the diff.`);
  }
  const highRisk=[...edited.filter(isHighRiskAppFile),...enforcementEdits];
  if(highRisk.length&&!hasAddedRiskTest(addedTestLines))
    errors.push(`A high-risk app or enforcement file changed (${highRisk.join(', ')}) without a new RISK test in the test files.`);
  if(enforcementEdits.length&&!hasAddedProcessRiskTest(addedTestLines))
    errors.push(`Test-first enforcement changed (${enforcementEdits.join(', ')}) without a new RISK process test in the test files.`);
  return errors;
}

// The fingerprint covers every executable test change so a record cannot be
// reused for a different diff. Blank lines and single-line comments cannot
// change what runs, so they are left out. With several test files each line
// also carries its file path, so a record cannot move to another file (#2213);
// tests.js lines keep their earlier form so records written for diffs against
// pre-split bases (which delete or edit tests.js) still verify.
const protectedTestLines=lines=>{
  const protectedLines=[];let cursor=null,file='';
  for(const line of lines){
    const hunk=line.match(/^@@ -(\d+)(?:,(\d+))? \+/);
    if(hunk){cursor=Number(hunk[1])+(hunk[2]==='0'?1:0);continue;}
    const header=line.match(/^(?:--- (?:a\/(.+)|\/dev\/null)|\+\+\+ (?:b\/(.+)|\/dev\/null))$/);
    if(header){const name=header[1]||header[2];if(name)file=name==='tests.js'?'':name;continue;}
    if(line.startsWith('---')||line.startsWith('+++'))continue;
    const content=line.slice(1).trim(),meaningful=content&&!content.startsWith('//');
    const location=`${file?file+':':''}${cursor??''}`;
    if(line.startsWith('-')){if(meaningful)protectedLines.push(`${location}:-${content}`);if(cursor!==null)cursor++;}
    else if(line.startsWith('+')){
      if(meaningful)protectedLines.push(`${location}:+${content}`);
    }else if(line.startsWith(' ')&&cursor!==null)cursor++;
  }
  return protectedLines;
};
export function protectedTestFingerprint(lines){
  return createHash('sha256').update(protectedTestLines(lines).join('\n')).digest('hex');
}
// A rationale is required only when existing coverage can shrink: a removed or
// changed line (deleted, renamed or weakened assertion), or a pure insertion
// that stops later assertions from running. Appended process.exit(0) once
// bypassed the whole suite and inserted returns or block comments can hide
// assertions, so those insertions still count as weakening. Ordinary added or
// extended tests cannot hide an existing contract and need no record (#2208).
const suppressesExistingTests=content=>
  /\bprocess\.exit(?:Code)?\b/.test(content)||/^return\s*;?$/.test(content)||
  /^if\s*\(\s*(?:false|0)\s*\)/.test(content)||/^\/\*|\/\*$|^\*\//.test(content)||
  /\.(?:skip|todo)\s*\(/.test(content);
const weakensExistingTests=lines=>protectedTestLines(lines).some(line=>{
  const change=line.slice(line.search(/:[-+]/)+1);
  return change.startsWith('-')||suppressesExistingTests(change.slice(1));
});
// The lines a diff weakens, by file and content but not line number (#2233):
// removed meaningful lines and inserted suppressors. A record that names them
// stays valid when later commits add or edit other tests or when merging main
// shifts line numbers; the whole-diff fingerprint went stale on every such
// change and cost a rebind commit each time.
export function weakenedTestLines(lines){
  const weakened=new Set();let file='';
  for(const line of lines){
    const header=line.match(/^(?:--- (?:a\/(.+)|\/dev\/null)|\+\+\+ (?:b\/(.+)|\/dev\/null))$/);
    if(header){const name=header[1]||header[2];if(name)file=name;continue;}
    if(line.startsWith('---')||line.startsWith('+++')||line.startsWith('@@'))continue;
    const content=line.slice(1).trim();
    if(!content||content.startsWith('//'))continue;
    if(line.startsWith('-'))weakened.add(`${file}:-${content}`);
    else if(line.startsWith('+')&&suppressesExistingTests(content))weakened.add(`${file}:+${content}`);
  }
  return [...weakened].sort();
}
const coversWeakening=(entry,weakened)=>Array.isArray(entry?.weakenedTestLines)&&
  weakened.every(line=>entry.weakenedTestLines.includes(line));
export function validateRegressionChanges(lines,records){
  if(!weakensExistingTests(lines))return [];
  const weakened=weakenedTestLines(lines);
  // Records written before #2233 keep matching the exact whole-diff fingerprint.
  const record=Array.isArray(records)&&(records.find(entry=>coversWeakening(entry,weakened))||
    records.find(entry=>entry?.testChangesSha256===protectedTestFingerprint(lines)));
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
      const deleted=diff('--name-only','--diff-filter=D').trim().split('\n').filter(Boolean);
      // tests.js stays in the protected diff because a base from before the
      // split still has it: deleting its tests must need a record like any other.
      const testDiff=execFileSync('git',['diff','--unified=0',`${base}...HEAD`,'--',LEGACY_TEST_FILE,'tests'],{encoding:'utf8',maxBuffer:256*1024*1024}).split('\n');
      const records=fs.existsSync('TEST_CHANGE_RATIONALES.json')?JSON.parse(fs.readFileSync('TEST_CHANGE_RATIONALES.json','utf8')):[];
      const errors=[...validateTestFirst(changed,testDiff,deleted),...validateRegressionChanges(testDiff,records)];
      if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}
      else process.stdout.write('Test-first diff gate passed.\n');
    }catch(error){process.stderr.write(`Could not compare ${base} to HEAD: ${error.message}\n`);process.exitCode=2;}
  }
}
