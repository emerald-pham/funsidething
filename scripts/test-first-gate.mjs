import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const base=process.argv[2];
  if(!base || !/^[0-9a-f]{40}$/.test(base)){
    process.stderr.write('Pass the 40-character base commit SHA.\n');process.exitCode=2;
  }else if(/^0+$/.test(base)){
    process.stdout.write('Initial branch push: no previous commit to compare.\n');
  }else{
    try{
      const diff=(...args)=>execFileSync('git',['diff',...args,`${base}...HEAD`],{encoding:'utf8'});
      const changed=diff('--name-only','--diff-filter=ACMRT').trim().split('\n').filter(Boolean);
      const testDiff=execFileSync('git',['diff','--unified=0',`${base}...HEAD`,'--','tests.js'],{encoding:'utf8'}).split('\n');
      const errors=validateTestFirst(changed,testDiff);
      if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}
      else process.stdout.write('Test-first diff gate passed.\n');
    }catch(error){process.stderr.write(`Could not compare ${base} to HEAD: ${error.message}\n`);process.exitCode=2;}
  }
}
