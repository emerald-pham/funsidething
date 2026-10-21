#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workflowDigest = '246620d6286b1dec129e1d7f59dc35bd0dd04f42f2249333968c85920cbbb492';
const nativeContract = 'RISK repository process: required installed-client native outcomes and artifacts execute exactly once';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = message => { throw new Error(message); };
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options });
function git(repo, ...args) {
  const result = run('git', ['-C', repo, ...args]);
  if (result.status !== 0) reject(result.stderr || result.error?.message || 'Git failed.');
  return result.stdout.trim();
}
function options(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--repo','--remote','--branch','--base','--evidence-dir','--native-port'].includes(key) || !args[i+1] || parsed[key]) reject('Expected unique named handoff options.');
    parsed[key] = args[i+1];
  }
  for (const key of ['--repo','--remote','--branch','--base','--evidence-dir','--native-port']) if (!parsed[key]) reject(`Required ${key}.`);
  if (!/^[a-f0-9]{40}$/.test(parsed['--base'])) reject('Base must be a full commit SHA.');
  if (!/^\d+$/.test(parsed['--native-port']) || +parsed['--native-port'] < 1024 || +parsed['--native-port'] > 65535) reject('An allocated native port is required.');
  if (parsed['--remote'].startsWith('-') || parsed['--branch'].startsWith('-') || ['main','master'].includes(parsed['--branch'])) reject('Use an existing named remote and explicit topic destination.');
  return parsed;
}
function sourceIdentity(repo) {
  const branch = git(repo,'symbolic-ref','--quiet','HEAD');
  if (['refs/heads/main','refs/heads/master'].includes(branch)) reject('Use an attached topic checkout.');
  if (git(repo,'status','--porcelain','--untracked-files=all')) reject('Candidate worktree must be clean.');
  return { branch, commit: git(repo,'rev-parse','HEAD'), tree: git(repo,'rev-parse','HEAD^{tree}') };
}
function remoteTip(repo, remote, ref) {
  const text = git(repo,'ls-remote','--refs',remote,ref);
  const lines = text.split('\n').filter(Boolean);
  if (lines.length > 1) reject('Ambiguous remote destination.');
  return lines[0]?.split(/\s+/)[0] ?? null;
}
// Query only lifecycle/dependency controls. Never collect npm's complete config:
// registry credentials and auth tokens do not belong in validation evidence.
function npmPolicy(repo) {
  const expected={'node-options':'null','script-shell':'null','ignore-scripts':'false','if-present':'false',
    workspaces:'null',workspace:'','include-workspace-root':'false',global:'false','dry-run':'false',
    omit:'',include:'',production:'null',only:'null'};
  const result=run('npm',['config','get',...Object.keys(expected)],{cwd:repo});
  if(result.status!==0||result.error||result.signal)reject('Could not establish effective npm lifecycle configuration.');
  const settings={};
  for(const line of result.stdout.trimEnd().split(/\r?\n/)) {
    const at=line.indexOf('=');
    if(at<0||!Object.hasOwn(expected,line.slice(0,at)))reject('Unrecognized npm lifecycle configuration output.');
    const key=line.slice(0,at),value=line.slice(at+1);
    if(Object.hasOwn(settings,key)||value!==expected[key])reject(`Unsupported effective npm lifecycle setting: ${key}.`);
    settings[key]=value;
  }
  if(Object.keys(settings).length!==Object.keys(expected).length)reject('Incomplete npm lifecycle configuration.');
  const prefix=run('npm',['prefix'],{cwd:repo});
  if(prefix.status!==0||prefix.error||prefix.signal||fs.realpathSync(prefix.stdout.trim())!==repo)reject('Effective npm project root differs from the captured checkout.');
  return settings;
}
function policy(repo, o, candidate) {
  if (process.versions.node.split('.')[0] !== '22' || !['darwin','linux'].includes(process.platform)) reject('Local handoff supports Node 22 on macOS/Linux; remote Ubuntu remains independently required.');
  const childNode=run('node',['--version']);
  if(childNode.status!==0||childNode.stdout.trim()!==process.version)reject('Child Node executable must match the supported Node 22 parent toolchain.');
  if (process.env.NODE_OPTIONS || process.env.CHAIN_INSTALLED_NATIVE_CHILD || process.env.FIRESTORE_EMULATOR_HOST) reject('Remove inherited test-runner overrides/emulator identity before the owned cohort.');
  const npmSettings=npmPolicy(repo);
  const workflow = fs.readFileSync(path.join(repo,'.github/workflows/data-safety.yml'));
  if (hash(workflow) !== workflowDigest) reject('Workflow policy changed; review the local cohort before handoff.');
  const packageBytes = fs.readFileSync(path.join(repo,'package.json')), scripts = JSON.parse(packageBytes).scripts;
  const expected = {test:'node --test tests.js scripts/agent-tools/*.test.mjs',
    'test:rules':`firebase emulators:exec --only firestore --project demo-chain-scanner-data-safety "node --test --test-name-pattern='Firestore rules:' tests.js"`,
    'test:compatibility':'firebase emulators:exec --only firestore --project demo-backward-compatibility "node scripts/backward-compatibility.mjs"'};
  for (const [key,value] of Object.entries(expected)) if (scripts[key] !== value) reject(`Required command configuration changed: ${key}.`);
  const java = run('java',['-version']);
  if (java.status !== 0 || !/version "21[."]/.test(java.stderr + java.stdout)) reject('Java 21 is required.');
  const hook = path.resolve(repo,git(repo,'rev-parse','--git-path','hooks/pre-push'));
  // Git resolves core.hooksPath in --git-path. Preserve its dispatcher and all
  // prior hooks; never use --no-verify or publish local status substitutions.
  const hookBytes = fs.readFileSync(hook);
  fs.accessSync(hook,fs.constants.X_OK);
  if (!hookBytes.includes(Buffer.from('codex-release-gate-managed-v1'))) reject('Install the existing release pre-push gate first.');
  const fetchUrls=git(repo,'remote','get-url','--all',o['--remote']).split('\n');
  const pushUrls=git(repo,'remote','get-url','--push','--all',o['--remote']).split('\n');
  if(fetchUrls.length!==1||pushUrls.length!==1||fetchUrls[0]!==pushUrls[0])reject('Use one matching fetch/push destination for exact CI handoff.');
  const commands = [['npm',['ci']],['npx',['--no-install','playwright','install',...(process.platform==='linux'?['--with-deps']:[]),'chromium']],
    [process.execPath,['scripts/test-first-gate.mjs',o['--base']]],['npm',['test']],['npm',['run','test:rules']],['npm',['run','test:compatibility']]];
  return {candidate,npmSettings,base:o['--base'],remote:o['--remote'],destination:`refs/heads/${o['--branch']}`,commands,
    gitConfigurationSha256:hash(git(repo,'config','--null','--list')),workflowSha256:hash(workflow),packageSha256:hash(packageBytes),lockSha256:hash(fs.readFileSync(path.join(repo,'package-lock.json'))),
    runnerSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),hook:{path:hook,sha256:hash(hookBytes)},
    node:process.version,platform:process.platform,java:(java.stderr+java.stdout).trim(),nativePort:o['--native-port'],
    limits:['Local execution does not establish Ubuntu equivalence.','Remote CI status must be observed separately.','Generated metadata is not tamper-proof attestation.']};
}
function optionalTests(repo) {
  const source=fs.readFileSync(path.join(repo,'tests.js'),'utf8'), result=[];
  const pattern=/^test\(\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))\s*,\s*\{\s*skip:\s*([^}]+)\}/gm;
  for(const match of source.matchAll(pattern)) {
    const expression=match[2].trim();
    if(!/^!process\.env\.[A-Z_]+(?:\s*\|\|\s*!process\.env\.[A-Z_]+)*$/.test(expression))continue;
    const title=match[1][0]==='"'?JSON.parse(match[1]):match[1].slice(1,-1).replace(/\\(['\\])/g,'$1');
    const variables=[...expression.matchAll(/process\.env\.([A-Z_]+)/g)].map(item=>item[1]);
    if(variables.some(name=>!process.env[name]))result.push(title);
  }
  return result;
}
function testResult(output, kind, optional) {
  const count = key => Number([...output.matchAll(new RegExp(`^# ${key} (\\d+)$`,'gm'))].at(-1)?.[1] ?? NaN);
  if (!(count('tests')>0 && count('pass')>0 && count('pass')+count('skipped')===count('tests') && count('fail')===0 && count('cancelled')===0 && count('todo')===0)) reject('Required tests did not complete successfully.');
  const topPlan=[...output.matchAll(/^1\.\.(\d+)$/gm)].at(-1)?.[1];
  if(!topPlan||Number(topPlan)!==output.split(/\r?\n/).filter(line=>/^ok \d+ - /.test(line)).length)reject('Required TAP plan is missing or incomplete.');
  const skipped=output.split(/\r?\n/).filter(line=>/^\s*ok \d+ - .* # SKIP/.test(line));
  if(skipped.length!==count('skipped'))reject('Incomplete skipped-test inventory.');
  for(const line of skipped) {
    const title=line.replace(/^\s*ok \d+ - /,'').replace(/ # SKIP.*$/,'');
    const allowed=kind==='test'&&title!==nativeContract&&optional.includes(title)
      ||kind==='test:rules'&&!title.startsWith('Firestore rules:')&&/ # SKIP test name does not match pattern$/.test(line);
    if(!allowed)reject(`Required case was skipped: ${title}.`);
  }
  if (kind==='test' && output.split(/\r?\n/).filter(line=>/^ok \d+ - /.test(line)&&line.replace(/^ok \d+ - /,'')===nativeContract).length!==1) reject('Existing required native process contract must complete exactly once.');
  if (kind==='test:rules' && !/^ok \d+ - Firestore rules:/m.test(output)) reject('Required rules cases did not execute.');
  if (kind==='test:compatibility' && count('tests')<15) reject('Required compatibility cohort is incomplete.');
}
function main() {
  const o = options(process.argv.slice(2)),repo=fs.realpathSync(o['--repo']),candidate=sourceIdentity(repo);
  git(repo,'check-ref-format',`refs/heads/${o['--branch']}`);
  if (!git(repo,'remote').split('\n').includes(o['--remote'])) reject('Use an existing named remote.');
  const plan = policy(repo,o,candidate), before = remoteTip(repo,plan.remote,plan.destination);
  const mainTip = remoteTip(repo,plan.remote,'refs/heads/main');
  const base = before ?? (mainTip && git(repo,'merge-base',mainTip,candidate.commit));
  if (before !== candidate.commit && base !== plan.base) reject('Comparison base does not match the existing push workflow destination/base.');
  const messages=git(repo,'log','--format=%B%x00',`${base}..${candidate.commit}`)+'\n'+git(repo,'show','-s','--format=%B',candidate.commit);
  if(/\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks:\s*true\s*$/im.test(messages))reject('Commit message suppresses GitHub CI through a skip directive/trailer.');
  const evidenceRoot=path.resolve(o['--evidence-dir']);
  if (evidenceRoot===repo || evidenceRoot.startsWith(repo+path.sep)) reject('Evidence must remain outside the checkout.');
  const directory=path.join(evidenceRoot,randomUUID());fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const record={schemaVersion:1,state:'prepared',startedAt:new Date().toISOString(),plan,previousRemote:before,results:[],publication:{state:'not-attempted'},remoteCi:{state:'unobserved',runId:null}};
  const save=()=>{const temp=path.join(directory,'summary.tmp');fs.writeFileSync(temp,JSON.stringify(record,null,2)+'\n',{mode:0o600});fs.renameSync(temp,path.join(directory,'summary.json'));};
  const unchanged=()=>{if(JSON.stringify(sourceIdentity(repo))!==JSON.stringify(candidate)||JSON.stringify(policy(repo,o,candidate))!==JSON.stringify(plan))reject('Candidate, hook, command or configuration changed during validation.');};
  save();
  try {
    if(before===candidate.commit){record.state='already-published';record.publication.state='no-op';save();console.log(`Already published; no new remote run inferred. evidence=${directory}`);return;}
    record.state='validating';save();
    for(const [index,[command,args]] of plan.commands.entries()) {
      unchanged();
      const env={...process.env,COMPATIBILITY_BASE_SHA:plan.base,CHAIN_NATIVE_CANDIDATE_SHA:candidate.commit,CHAIN_NATIVE_CANDIDATE_TREE:candidate.tree,
        CHAIN_NATIVE_OUTPUT:path.join(directory,'native'),CHAIN_NATIVE_PORT:plan.nativePort};
      const result=run(command,args,{cwd:repo,env}),output=(result.stdout??'')+(result.stderr??'');
      fs.writeFileSync(path.join(directory,`${index}.log`),output,{mode:0o600});
      record.results.push({command,args,exitCode:result.status,signal:result.signal,error:result.error?.message,log:`${index}.log`,outputSha256:hash(output),completedAt:new Date().toISOString()});save();
      if(result.status!==0||result.signal||result.error)reject(`Required command failed or was incomplete: ${command} ${args.join(' ')}.`);
      if(index>=3)testResult(output,index===3?'test':args[1],optionalTests(repo));
      unchanged();
    }
    record.state='qualified';save();unchanged();
    if(remoteTip(repo,plan.remote,plan.destination)!==before||remoteTip(repo,plan.remote,'refs/heads/main')!==mainTip)reject('Remote destination or comparison base changed during validation.');
    record.state='publishing';record.publication.state='attempting';save();
    const result=run('git',['-C',repo,'push','--porcelain',plan.remote,`${candidate.commit}:${plan.destination}`]),output=(result.stdout??'')+(result.stderr??'');
    fs.writeFileSync(path.join(directory,'push.log'),output,{mode:0o600});
    record.publication={state:result.status===0?'published':'failed-or-uncertain',exitCode:result.status,signal:result.signal,log:'push.log',outputSha256:hash(output)};
    record.state=result.status===0?'published':'publication-unresolved';save();
    if(result.status!==0)reject('Ordinary push failed or is uncertain. Inspect remote state; no push or local cohort was retried.');
    console.log(`Published exact revision ${candidate.commit}; remote CI remains unobserved. evidence=${directory}`);
  } catch(error) {
    if(!['publishing','publication-unresolved'].includes(record.state))record.state='rejected';record.error=error.message;save();throw error;
  }
}
try {main();} catch(error){console.error(`ci-handoff: ${error.message}`);process.exitCode=1;}
