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
const highRiskAppFile=/(?:^|\/)(?:[^/]+\.html?|sw\.js|[^/]+\.webmanifest|app-release\.js)$/i;
// Data modules by the release validator's path vocabulary, plus the lz-string
// codec that encodes backup archives (#2233 review).
const highRiskDataPath=/(?:store|cloud|sync|storage|persist|backup|recovery|auth|session|firestore|account|indexeddb|migrat|lz-string)/i;
const isHighRiskAppFile=file=>file==='firestore.rules'||isAppFile(file)&&(highRiskAppFile.test(file)||highRiskDataPath.test(file));
const hasAddedRiskTest=lines=>lines.some(line=>/^\+\s*test\s*\(\s*['"]RISK\b/.test(line));
const hasAddedProcessRiskTest=lines=>lines.some(line=>/^\+\s*test\s*\(\s*['"]RISK (?:test-first gate|regression gate|test inventory|repository process)\b/.test(line));

// deletedFiles lets the split itself through: against a base from before
// #2213, the diff deletes tests.js, and those deleted lines stay protected by
// the rationale check below. Adding or editing a root tests.js is rejected.
// bookkeepingOnly names shell files whose diff only adds changelog text and
// refreshes the app fingerprint or CACHE_NAME. Every app change does that, so it
// must not make a scenery fix high-risk (#2233 review).
export function validateTestFirst(changedFiles,addedTestLines,deletedFiles=[],bookkeepingOnly=[]){
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
  const highRisk=[...edited.filter(file=>isHighRiskAppFile(file)&&!bookkeepingOnly.includes(file)),...enforcementEdits];
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
  // Kept as a list, not a set: identical assertions repeat across tests, so
  // each listed line covers exactly one weakening (#2233 review).
  const weakened=[];let file='';
  for(const line of lines){
    const header=line.match(/^(?:--- (?:a\/(.+)|\/dev\/null)|\+\+\+ (?:b\/(.+)|\/dev\/null))$/);
    if(header){const name=header[1]||header[2];if(name)file=name;continue;}
    if(line.startsWith('---')||line.startsWith('+++')||line.startsWith('@@'))continue;
    const content=line.slice(1).trim();
    if(!content||content.startsWith('//'))continue;
    if(line.startsWith('-'))weakened.push(`${file}:-${content}`);
    else if(line.startsWith('+')&&suppressesExistingTests(content))weakened.push(`${file}:+${content}`);
  }
  return weakened.sort();
}
const coversWeakening=(entry,weakened)=>{
  if(!Array.isArray(entry?.weakenedTestLines))return false;
  const listed=new Map();for(const line of entry.weakenedTestLines)listed.set(line,(listed.get(line)||0)+1);
  return weakened.every(line=>{const left=listed.get(line)||0;listed.set(line,left-1);return left>0;});
};
export function validateRegressionChanges(lines,records){
  if(!weakensExistingTests(lines))return [];
  const weakened=weakenedTestLines(lines);
  // Records written before #2233 keep matching the exact whole-diff fingerprint.
  // Any covering record that fully validates approves the diff: the ledger is
  // append-only, so an older record listing the same generic line must not
  // shadow this diff's own record (#2233 review).
  const candidates=Array.isArray(records)?[...records.filter(entry=>coversWeakening(entry,weakened)),
    ...records.filter(entry=>entry?.testChangesSha256===protectedTestFingerprint(lines))]:[];
  if(!candidates.length)return ['Existing tests were changed or removed without an exact-diff rationale in TEST_CHANGE_RATIONALES.json.'];
  const results=candidates.map(entry=>recordErrors(entry,lines));
  return results.find(errors=>!errors.length)||results[0];
}
function recordErrors(record,lines){
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

// True when every changed line of the file lies inside the changelog block or is
// the worker CACHE_NAME line. A moved changelog marker or an unreadable side
// counts as real change (fail closed).
function onlyReleaseBookkeeping(base,file){
  const show=ref=>{try{return execFileSync('git',['show',`${ref}:${file}`],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']});}catch{return null;}};
  // The patch below is base...HEAD, numbered from the merge-base, so the old
  // side is read there too (#2233 review).
  let mergeBase;try{mergeBase=execFileSync('git',['merge-base',base,'HEAD'],{encoding:'utf8'}).trim();}catch{return false;}
  const sides={'-':show(mergeBase),'+':show('HEAD')};
  if(sides['-']===null||sides['+']===null)return false;
  const changelog=text=>{const inside=new Set();let open=false;text.split(/\r?\n/).forEach((line,index)=>{
    if(line.includes('<!-- changelog:start -->'))open=true;if(open)inside.add(index+1);if(line.includes('<!-- changelog:end -->'))open=false;});return inside;};
  const blocks={'-':changelog(sides['-']),'+':changelog(sides['+'])};
  const patch=execFileSync('git',['diff','--unified=0',`${base}...HEAD`,'--',file],{encoding:'utf8',maxBuffer:64*1024*1024});
  let oldLine=0,newLine=0,inHunk=false;
  for(const line of patch.split('\n')){
    const hunk=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if(hunk){inHunk=true;oldLine=Number(hunk[1]);newLine=Number(hunk[2]);continue;}
    const side=line[0];if(!inHunk||(side!=='+'&&side!=='-'))continue;
    const number=side==='+'?newLine++:oldLine++,text=line.slice(1);
    if(/<!-- changelog:(?:start|end) -->/.test(text))return false;
    // Changelog markup is injected into the page, so a line that loads or runs
    // script is code, as the release review classifier treats it.
    if(/<\/?script\b|\bon[a-z]+\s*=|javascript:/i.test(text))return false;
    if(/^\s*const\s+CACHE_NAME\s*=\s*["']chain-scanner-shell-[a-f0-9]+["'];?\s*$/.test(text))continue;
    if(!blocks[side].has(number))return false;
  }
  return true;
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
      const bookkeeping=changed.filter(file=>/(?:^|\/)(?:[^/]+\.html?|sw\.js)$/i.test(file)&&!deleted.includes(file)&&onlyReleaseBookkeeping(base,file));
      const errors=[...validateTestFirst(changed,testDiff,deleted,bookkeeping),...validateRegressionChanges(testDiff,records)];
      if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}
      else process.stdout.write('Test-first diff gate passed.\n');
    }catch(error){process.stderr.write(`Could not compare ${base} to HEAD: ${error.message}\n`);process.exitCode=2;}
  }
}
