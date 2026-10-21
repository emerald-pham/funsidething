import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(source, 'scripts/agent-tools/ci-handoff.mjs');
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
const nativeTitle = 'RISK repository process: required installed-client native outcomes and artifacts execute exactly once';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'chain-corrected-handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo'), remote = path.join(root, 'remote.git'), bin = path.join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  git(root, 'init', '--bare', remote); git(repo, 'init', '-b', 'topic');
  git(repo, 'config', 'user.email', 'fixture@example.invalid'); git(repo, 'config', 'user.name', 'Fixture');
  mkdirSync(path.join(repo, '.github/workflows'), { recursive: true });
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  writeFileSync(path.join(repo, '.github/workflows/data-safety.yml'), readFileSync(path.join(source, '.github/workflows/data-safety.yml')));
  writeFileSync(path.join(repo, 'package.json'), readFileSync(path.join(source, 'package.json')));
  writeFileSync(path.join(repo, 'package-lock.json'), '{}');
  writeFileSync(path.join(repo, 'tests.js'), `import test from 'node:test';\ntest('${nativeTitle}',()=>{});\n`);
  writeFileSync(path.join(repo, 'scripts/test-first-gate.mjs'), "import fs from 'node:fs'; fs.appendFileSync(process.env.CALLS, JSON.stringify(['diff-gate',process.argv[2]])+'\\n'); console.log('Test-first diff gate passed.');\n");
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'fixture');
  const sha = git(repo, 'rev-parse', 'HEAD'); git(repo, 'remote', 'add', 'origin', remote); git(root, '--git-dir', remote, 'fetch', repo, 'HEAD:refs/heads/main');
  const hook = path.join(repo, '.git/hooks/pre-push');
  writeFileSync(hook, '#!/bin/sh\n# codex-release-gate-managed-v1 simulated external release receipt approval\nprintf "hook accepted\\n" >> "$HOOK_CALLS"\nexit 0\n'); chmodSync(hook, 0o755);
  const boundary = `#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2),name=process.argv[1].split('/').at(-1);
fs.appendFileSync(process.env.CALLS,JSON.stringify([name,...args])+'\\n');
if(name==='java'){console.error('openjdk version "21.0.1"');process.exit(0);}
if(name==='npx'||args[0]==='ci'){console.log('fixture preparation completed');process.exit(0);}
const rules=args[1]==='test:rules',compat=args[1]==='test:compatibility';
const titles=compat?Array.from({length:15},(_,i)=>'compatibility '+i):[rules?'Firestore rules: required simulated contract':${JSON.stringify(nativeTitle)}];
console.log('TAP version 13');
for(const [i,title] of titles.entries())console.log('ok '+(i+1)+' - '+title);
console.log('1..'+titles.length+'\\n# tests '+titles.length+'\\n# suites 0\\n# pass '+titles.length+'\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');
`;
  for (const name of ['npm','npx','java']) { writeFileSync(path.join(bin,name),boundary); chmodSync(path.join(bin,name),0o755); }
  writeFileSync(path.join(bin,'package.json'),'{"type":"module"}');
  const evidence=path.join(root,'evidence'),calls=path.join(root,'calls'),hookCalls=path.join(root,'hooks');
  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,CALLS:calls,HOOK_CALLS:hookCalls};
  return {root,repo,remote,bin,sha,hook,evidence,calls,hookCalls,env};
}
function invoke(f) {
  const args=[cli,'--repo',f.repo,'--remote','origin','--branch','ci/fixture','--base',f.sha,'--evidence-dir',f.evidence,'--native-port','39871'];
  return spawnSync(process.execPath,args,{env:f.env,encoding:'utf8'});
}
function manualCompleteCohort(f) {
  // Current manual validation: same complete planned commands with external
  // boundaries simulated. No implementation exists in this clean checkout.
  const commands=[['npm',['ci']],['npx',['--no-install','playwright','install',...(process.platform==='linux'?['--with-deps']:[]),'chromium']],
    [process.execPath,['scripts/test-first-gate.mjs',f.sha]],['npm',['test']],['npm',['run','test:rules']],['npm',['run','test:compatibility']]];
  for(const [command,args] of commands){
    const result=spawnSync(command,args,{cwd:f.repo,env:f.env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr+result.stdout);
    if(command==='npm'&&args[0]!=='ci'){
      const expected=args[1]==='test:compatibility'?15:1;
      assert.match(result.stdout,new RegExp('^# tests '+expected+'$','m'));
      assert.match(result.stdout,new RegExp('^# pass '+expected+'$','m'));
      assert.match(result.stdout,/^# fail 0$/m);assert.match(result.stdout,/^# cancelled 0$/m);assert.match(result.stdout,/^# skipped 0$/m);
    }
    console.log('SIMULATED PROCESS BASELINE completed:',command,...args);
    console.log(result.stdout.trim());
  }
  return {status:0,stdout:'',stderr:''};
}

test('complete applicable simulated local cohort automatically publishes the captured revision through the ordinary hook',t=>{
  const f=fixture(t);
  const baseline=process.env.CHAIN_HANDOFF_COMPLETE_MANUAL_BASELINE==='1';
  const result=baseline?manualCompleteCohort(f):invoke(f);
  assert.equal(result.status,0,result.stderr+result.stdout);
  const calls=readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse).filter(call=>call[0]!=='java');
  assert.deepEqual(calls,[['npm','ci'],['npx','--no-install','playwright','install',...(process.platform==='linux'?['--with-deps']:[]),'chromium'],
    ['diff-gate',f.sha],['npm','test'],['npm','run','test:rules'],['npm','run','test:compatibility']], 'all required stages completed once');
  const remote=spawnSync('git',['--git-dir',f.remote,'rev-parse','--verify','refs/heads/ci/fixture'],{encoding:'utf8'});
  assert.equal(remote.stdout.trim(),f.sha,'a complete successful local cohort must automatically publish the captured revision');
  assert.equal(readFileSync(f.hookCalls,'utf8'),'hook accepted\n');
});
