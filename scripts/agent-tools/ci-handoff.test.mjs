import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(source, 'scripts/agent-tools/ci-handoff.mjs');
const npmCli=realpathSync(process.env.npm_execpath??process.env.PATH.split(path.delimiter).map(directory=>path.join(directory,'npm')).find(candidate=>existsSync(candidate)));
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
if(name==='npm'&&(args[0]==='config'||args[0]==='prefix')){const {spawnSync}=await import('node:child_process');const result=spawnSync(process.execPath,[${JSON.stringify(npmCli)},...args],{encoding:'utf8',env:process.env});process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);}
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

function replaceBoundary(f, before, after) {
  const target=path.join(f.bin,'npm'),text=readFileSync(target,'utf8');
  assert.ok(text.includes(before),'fixture replacement must reach its external boundary');
  writeFileSync(target,text.replace(before,after));
}
function summary(f) {
  const attempts=readdirSync(f.evidence);assert.equal(attempts.length,1);
  return JSON.parse(readFileSync(path.join(f.evidence,attempts[0],'summary.json'),'utf8'));
}
function absent(f) {
  const result=spawnSync('git',['--git-dir',f.remote,'show-ref','--verify','refs/heads/ci/fixture'],{encoding:'utf8'});
  assert.notEqual(result.status,0,'rejected qualification must leave remote topic absent');
}

test('source-declared optional browser exclusions do not turn a complete applicable cohort into an incomplete run',t=>{
  const f=fixture(t);
  writeFileSync(path.join(f.repo,'tests.js'),readFileSync(path.join(f.repo,'tests.js'),'utf8')+"test('Optional browser fixture',{skip:!process.env.LANDSCAPE_BROWSER_URL},()=>{});\n");
  git(f.repo,'add','tests.js');git(f.repo,'commit','-m','declare optional browser fixture');
  replaceBoundary(f,"console.log('1..'+titles.length", "if(!rules&&!compat){console.log('ok 2 - Optional browser fixture # SKIP');}\nconsole.log('1..'+(titles.length+(!rules&&!compat?1:0))");
  // Keep complete independent TAP counts rather than accepting an exit-zero log.
  replaceBoundary(f,"'\\n# tests '+titles.length", "'\\n# tests '+(titles.length+(!rules&&!compat?1:0))");
  replaceBoundary(f,"\\n# skipped 0", "\\n# skipped '+(!rules&&!compat?1:0)+'");
  const result=invoke(f);assert.equal(result.status,0,result.stderr+result.stdout);
  assert.equal(summary(f).state,'published');
});

test('GitHub skip-CI directives and trailers never qualify a revision for automatic CI handoff',async t=>{
  for(const message of ['fixture [skip ci]','fixture [ci skip]','fixture [no ci]','fixture [skip actions]','fixture [actions skip]',
    'fixture\n\n\nskip-checks:true','fixture\n\n\nskip-checks: true']) {
    await t.test(JSON.stringify(message),t=>{
      const f=fixture(t);git(f.repo,'commit','--allow-empty','--cleanup=verbatim','-m',message);
      const result=invoke(f);assert.notEqual(result.status,0,'a suppressed remote workflow must not qualify');absent(f);
      assert.match(result.stderr,/skip|suppress/i);
    });
  }
});

test('already published revision does not repeat local validation or infer a new remote run',t=>{
  const f=fixture(t);git(f.repo,'commit','--allow-empty','-m','topic candidate');assert.equal(invoke(f).status,0);
  const calls=readFileSync(f.calls,'utf8').split('\n').filter(line=>line&&!line.includes('"java"'));
  const result=invoke(f);assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/no new remote run/i);
  assert.deepEqual(readFileSync(f.calls,'utf8').split('\n').filter(line=>line&&!line.includes('"java"')),calls);
});

test('nonzero cancelled incomplete and required-skipped results cannot publish',async t=>{
  for(const [name,change] of [
    ['nonzero',"if(args[0]==='test')process.exit(9);"],
    ['cancelled',"if(args[0]==='test')process.kill(process.pid,'SIGTERM');"],
    ['unfinished',"if(args[0]==='test'){console.log('TAP version 13\\nok 1 - unfinished');process.exit(0);}"],
    ['skipped-required',"if(args[0]==='test'){console.log('TAP version 13\\nok 1 - required # SKIP\\n1..1\\n# tests 1\\n# pass 0\\n# fail 0\\n# cancelled 0\\n# skipped 1\\n# todo 0');process.exit(0);}"],
    ['missing-native',"if(args[0]==='test'){console.log('TAP version 13\\nok 1 - unrelated\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');process.exit(0);}"],
    ['short-compatibility',"if(args[1]==='test:compatibility'){console.log('TAP version 13\\nok 1 - unrelated\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');process.exit(0);}"],
  ])await t.test(name,t=>{
    const f=fixture(t);replaceBoundary(f,"const rules=args[1]",change+"\nconst rules=args[1]");
    const result=invoke(f);assert.notEqual(result.status,0);absent(f);
    assert.equal(summary(f).publication.state,'not-attempted');
  });
});

test('dirty stale and changed configuration inputs cannot publish',async t=>{
  for(const kind of ['dirty','stale-base','workflow','commands','changed-during-run','revision-during-run','hook-during-run'])await t.test(kind,t=>{
    const f=fixture(t);
    if(kind==='dirty')writeFileSync(path.join(f.repo,'untracked'),'dirty');
    if(kind==='stale-base')f.sha='f'.repeat(40);
    if(kind==='workflow'||kind==='commands'){
      const target=path.join(f.repo,kind==='workflow'?'.github/workflows/data-safety.yml':'package.json');
      const contents=readFileSync(target,'utf8');
      writeFileSync(target,kind==='workflow'?contents+'\n# unmapped stage\n':contents.replace('node --test tests.js','node --test --test-name-pattern=narrow tests.js'));
      git(f.repo,'add','.');git(f.repo,'commit','-m','configuration change');
    }
    if(kind==='changed-during-run')replaceBoundary(f,"const rules=args[1]","if(args[0]==='test')fs.appendFileSync('package.json',' ');\nconst rules=args[1]");
    if(kind==='revision-during-run')replaceBoundary(f,"const rules=args[1]","if(args[0]==='test'){const {spawnSync}=await import('node:child_process');spawnSync('git',['commit','--allow-empty','-m','concurrent commit']);}\nconst rules=args[1]");
    if(kind==='hook-during-run')replaceBoundary(f,"const rules=args[1]","if(args[0]==='test')fs.appendFileSync('.git/hooks/pre-push','\\n# changed');\nconst rules=args[1]");
    const result=invoke(f);assert.notEqual(result.status,0);absent(f);
  });
});

test('ordinary pre-push receipt denial is preserved and does not repeat validation or publication',t=>{
  const f=fixture(t);writeFileSync(f.hook,'#!/bin/sh\n# codex-release-gate-managed-v1 simulated receipt denial\necho rejected >> "$HOOK_CALLS"\necho "Release receipt denied" >&2\nexit 1\n');
  const result=invoke(f);assert.notEqual(result.status,0);absent(f);
  assert.equal(readFileSync(f.hookCalls,'utf8'),'rejected\n');
  const record=summary(f);assert.equal(record.state,'publication-unresolved');assert.equal(record.results.length,6);
  assert.equal(record.publication.state,'failed-or-uncertain');assert.equal(record.remoteCi.state,'unobserved');
  assert.match(result.stderr,/no push or local cohort was retried/i);
});

test('an unsupported child Node toolchain cannot qualify through a supported parent executable',t=>{
  const f=fixture(t);writeFileSync(path.join(f.bin,'node'),`#!/bin/sh\nif [ \"$1\" = --version ]; then echo v23.10.0; else exec \"${process.execPath}\" \"$@\"; fi\n`);chmodSync(path.join(f.bin,'node'),0o755);
  const result=invoke(f);assert.notEqual(result.status,0,'npm children must use the supported Node toolchain');absent(f);
});

test('a truncated TAP stream with success counters but no completed plan cannot qualify',t=>{
  const f=fixture(t);replaceBoundary(f,"'1..'+titles.length+'\\n# tests '","'# tests '");
  const result=invoke(f);assert.notEqual(result.status,0,'success counters do not establish a completed test plan');absent(f);
});

test('a remote configuration redirect during validation cannot publish into another destination',t=>{
  const f=fixture(t),other=path.join(f.root,'other.git');git(f.root,'clone','--bare',f.remote,other);
  replaceBoundary(f,"const rules=args[1]",`if(args[0]==='test'){const {spawnSync}=await import('node:child_process');spawnSync('git',['remote','set-url','origin',${JSON.stringify(other)}]);}\nconst rules=args[1]`);
  const result=invoke(f);assert.notEqual(result.status,0,'changing the remote must invalidate qualification');
  const target=spawnSync('git',['--git-dir',other,'show-ref','--verify','refs/heads/ci/fixture'],{encoding:'utf8'});
  assert.notEqual(target.status,0);
});


function useActualNpmTests(f) {
  delete f.env.NODE_TEST_CONTEXT;
  mkdirSync(path.join(f.repo,'scripts/agent-tools'),{recursive:true});
  writeFileSync(path.join(f.repo,'scripts/agent-tools/fixture.test.mjs'),"import test from 'node:test'; test('agent fixture',()=>{});\n");
  writeFileSync(path.join(f.repo,'tests.js'),`import test from 'node:test';\ntest('${nativeTitle}',()=>{});\ntest('required full-cohort regression',()=>{throw Error('required full-cohort regression executed');});\n`);
  git(f.repo,'add','.');git(f.repo,'commit','-m','failing required full-cohort fixture');
  replaceBoundary(f,"const rules=args[1]",`if(args[0]==='test'||args[0]==='config'||args[0]==='prefix'){const {spawnSync}=await import('node:child_process');const result=spawnSync(process.execPath,[${JSON.stringify(npmCli)},...args],{encoding:'utf8',env:process.env});process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);}\nconst rules=args[1]`);
}

test('npm lifecycle Node overrides cannot narrow the required actual npm test cohort and publish',t=>{
  const f=fixture(t);useActualNpmTests(f);
  const ordinary=spawnSync(process.execPath,[npmCli,'test'],{cwd:f.repo,env:f.env,encoding:'utf8'});
  assert.notEqual(ordinary.status,0);assert.match(ordinary.stdout,/required full-cohort regression executed/);
  console.log('Actual ordinary fixture npm test fails its required full-cohort regression.');
  f.env.npm_config_node_options='--test-name-pattern=^RISK';
  const result=invoke(f);
  assert.notEqual(result.status,0,'npm lifecycle overrides must not narrow the applicable cohort into qualification');absent(f);
});

test('effective npm file and environment controls are rejected without exposing configuration values',async t=>{
  for(const [kind,key,value] of [
    ['project-file','node-options','--test-name-pattern=^RISK'],
    ['environment','NPM_CONFIG_NODE_OPTIONS','--test-name-pattern=^RISK'],
    ['environment','npm_config_script_shell','/private/secret-fixture-shell'],
    ['environment','npm_config_ignore_scripts','true'],
    ['environment','npm_config_if_present','true'],
    ['environment','npm_config_workspaces','true'],
    ['environment','npm_config_dry_run','true'],
    ['environment','npm_config_omit','dev'],
    ['environment','npm_config_global','true'],
  ])await t.test(key,t=>{
    const f=fixture(t);
    if(kind==='project-file'){writeFileSync(path.join(f.repo,'.npmrc'),`${key}=${value}\n`);git(f.repo,'add','.npmrc');git(f.repo,'commit','-m','local npm lifecycle override');}
    else f.env[key]=value;
    const result=invoke(f);assert.notEqual(result.status,0);absent(f);
    if(value.includes('secret-fixture'))assert.ok(!(result.stdout+result.stderr).includes(value),'unsupported setting values stay out of output');
  });
});
