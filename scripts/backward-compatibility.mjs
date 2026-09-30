import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Keep an immutable support floor as well as the rolling release base. Testing
// only HEAD against itself would let a breaking change redefine compatibility.
export const SUPPORTED_RELEASE='7b9c92a41999a44a12f92b7d6d1c8d02758c635e';
const HISTORICAL_BREAK='cd170750f12a60b077cf6fd498f8075f6759539e';
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).trimEnd();
const requireSha=sha=>assert.match(sha||'',/^[a-f0-9]{40}$/,'compatibility requires a full commit SHA');

export function readReleasedClient(root,sha){
  requireSha(sha);
  return {label:sha,html:git(root,'show',`${sha}:index.html`),
    cloud:git(root,'show',`${sha}:cloud-store-v2.js`),
    storage:git(root,'show',`${sha}:device-store-v2.js`),rules:git(root,'show',`${sha}:firestore.rules`)};
}

export async function assertRoundTrip(client,payload,baseRev,label){
  const written=await client.push(payload,1,baseRev);
  assert.equal(written?.ok,true,`${label}: upload was not acknowledged (${client.errorCode||'unknown'})`);
  assert.equal(written.rev,baseRev+1,`${label}: upload revision`);
  const read=await client.pull();
  assert.equal(read?.payload,payload,`${label}: payload changed or became unreadable`);
  assert.equal(read.rev,written.rev,`${label}: read revision`);
  assert.equal(client.status,'ok',`${label}: successful roundtrip status`);
  return read;
}

export function validateGateSummary(output){
  const count=name=>Number(output.match(new RegExp(`^# ${name} (\\d+)$`,'m'))?.[1]??NaN);
  assert.ok(count('tests')>=15 && count('pass')===count('tests') && count('fail')===0 &&
    count('cancelled')===0 && count('skipped')===0,'Backward compatibility requires a complete run with no skipped cases');
}

function loadBackend(artifacts,db,F,uid){
  const module=artifacts.html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(module,`${artifacts.label}: missing real Firebase backend`);
  const imports=/const \[appMod, A, F\] = await Promise\.all\(\[[\s\S]*?\]\);/;
  assert.ok(imports.test(module),`${artifacts.label}: backend import adapter must be updated explicitly`);
  // Only substitute SDK loading/auth plumbing. Transactions, envelopes, codecs,
  // error handling and generation cleanup execute the actual released source.
  const source=module.replace(imports,'const [appMod,A,F]=globalThis.__modules;');
  const auth={currentUser:{uid,email:`${uid}@example.test`}},pending=new Set(),errors=[];
  const sdk={...F,getFirestore:()=>db};
  // The VM and SDK have different Object prototypes. Re-home only ordinary
  // containers; retain every field and SDK sentinel without changing the wire
  // format. Otherwise Firestore rejects valid VM objects before checking rules.
  const hostValue=value=>Array.isArray(value)?Array.from(value,hostValue)
    :value?.constructor?.name==='Object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hostValue(v)])):value;
  const writer=target=>new Proxy(target,{get(object,key){
    const value=object[key];
    if(typeof value!=='function')return value;
    return (...args)=>Reflect.apply(value,object,['set','update'].includes(key)?args.map(hostValue):args);
  }});
  sdk.writeBatch=(...args)=>writer(F.writeBatch(...args));
  for(const key of ['getDoc','getDocs','runTransaction']){
    sdk[key]=(...args)=>{
      if(key==='runTransaction'){
        const callback=args[1];args[1]=tx=>callback(writer(tx));
      }
      const promise=F[key](...args).catch(error=>{errors.push({method:key,code:error.code});throw error;});pending.add(promise);
      promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;
    };
  }
  const window={FIREBASE_CONFIG:{apiKey:'emulator-only'},dispatchEvent(){}};
  const A={getAuth:()=>auth,setPersistence:async()=>{},browserLocalPersistence:{},onAuthStateChanged:(_,fn)=>fn(auth.currentUser)};
  const context=vm.createContext({window,crypto:webcrypto,TextEncoder,TextDecoder,structuredClone,
    console,setTimeout,clearTimeout,CustomEvent:class{},__modules:[{initializeApp:()=>({})},A,sdk]});
  for(const [file,code] of [['device-store-v2.js',artifacts.storage],['cloud-store-v2.js',artifacts.cloud]]){
    if(code)vm.runInContext(code,context,{filename:`${artifacts.label}/${file}`});
  }
  window.ChainStorageV2=context.ChainStorageV2;window.ChainCloudV2=context.ChainCloudV2;
  return {errors,async start(){
    await vm.runInContext(`(async()=>{${source}\n})()`,context,{filename:`${artifacts.label}/firebase-backend`});
    assert.equal(window.CloudSync.ready,true,`${artifacts.label}: backend initialization`);
    assert.notEqual(window.CloudSync.errorStage,'init',`${artifacts.label}: backend initialization error`);
    return window.CloudSync;
  },async drain(){
    // push() intentionally starts garbage collection without awaiting it.
    // Let its real Firestore reads/transactions finish before emulator cleanup.
    for(let idle=0;idle<2;){
      if(pending.size){idle=0;await Promise.allSettled([...pending]);}else idle++;
      await new Promise(resolve=>setImmediate(resolve));
    }
  }};
}

export async function runCompatibilityMatrix(root,{base}={}){
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Firestore emulator is required; compatibility may not skip');
  base=base||git(root,'rev-parse','origin/main');requireSha(base);
  // A missing baseline or shallow history is a hard failure, never a fallback
  // to candidate code. Keep all baseline objects available in CI's full clone.
  git(root,'merge-base','--is-ancestor',SUPPORTED_RELEASE,base);
  git(root,'merge-base','--is-ancestor',base,'HEAD');
  const baselines=[...new Set([SUPPORTED_RELEASE,base])];
  const candidate={label:'candidate',html:fs.readFileSync(path.join(root,'index.html'),'utf8'),
    storage:fs.readFileSync(path.join(root,'device-store-v2.js'),'utf8'),
    cloud:fs.readFileSync(path.join(root,'cloud-store-v2.js'),'utf8'),rules:fs.readFileSync(path.join(root,'firestore.rules'),'utf8')};
  const {initializeTestEnvironment,assertFails}=await import('@firebase/rules-unit-testing');
  const F=await import('firebase/firestore');
  const report={baselines,cases:[],historicalBreakDetected:false};
  let index=0;
  for(const sha of baselines){
    const released=readReleasedClient(root,sha);
    for(const direction of ['old-client/new-rules','new-client/old-rules']){
      const rules=direction==='old-client/new-rules'?candidate.rules:released.rules;
      const env=await initializeTestEnvironment({projectId:`demo-backward-compatibility-${index++}`,firestore:{rules}});
      const handles=[],traces=new WeakMap();
      const start=async(artifacts,uid)=>{
        const handle=loadBackend(artifacts,env.authenticatedContext(uid).firestore(),F,uid);
        handles.push(handle);const client=await handle.start();traces.set(client,handle);return client;
      };
      try{
        // A deployed legacy board includes unknown data and history. Successful
        // auth/read alone is not compatibility: require migration and exact bytes.
        const uid='returning-user',legacy=JSON.stringify({tasks:[{id:'old',title:'Legacy task',done:false}],
          history:[{id:'history',kind:'done'}],future:{keep:'unknown data'},settings:{theme:'dark'}});
        await env.withSecurityRulesDisabled(context=>F.setDoc(F.doc(context.firestore(),'users',uid),{payload:legacy,updatedAt:1,rev:0}));
        const old=await start(released,uid),next=await start(candidate,uid);
        for(const client of [old,next])assert.equal((await client.pull()).payload,legacy,`${direction}: legacy read`);
        const first=direction==='old-client/new-rules'?old:next,second=first===old?next:old;
        await assertRoundTrip(first,legacy,0,`${direction}: migrate legacy board`);
        assert.equal((await second.pull()).payload,legacy,`${direction}: peer reads migration`);
        const large=JSON.stringify({...JSON.parse(legacy),future:{keep:'unknown data',blob:'😀 retained '.repeat(100000)}});
        assert.ok(Buffer.byteLength(large)>1048576,'exercise real chunked storage beyond the old document limit');
        await assertRoundTrip(second,large,1,`${direction}: peer writes large board`);
        assert.equal((await first.pull()).payload,large,`${direction}: older/newer reader preserves large payload`);
        const stale=await first.push('stale overwrite',2,1);
        assert.equal(stale?.conflict,true,`${direction}: stale write must conflict`);
        assert.equal((await second.pull()).payload,large,`${direction}: conflict must preserve board`);
        await assertRoundTrip(first,legacy,2,`${direction}: original client edits after peer`);
        assert.equal((await second.pull()).payload,legacy,`${direction}: final cross-version read`);
        const stranger=env.authenticatedContext('other-account').firestore(),guest=env.unauthenticatedContext().firestore();
        await assertFails(F.getDoc(F.doc(stranger,'users',uid)));
        await assertFails(F.getDoc(F.doc(guest,'users',uid)));
        await assertFails(F.setDoc(F.doc(stranger,'users',uid),{payload:'overwrite',updatedAt:1,rev:4,serverUpdatedAt:F.serverTimestamp()}));
        await assertFails(F.deleteDoc(F.doc(env.authenticatedContext(uid).firestore(),'users',uid)));
        report.cases.push({baseline:sha,direction,legacyMigration:true,staleWriteRejected:true,ownerIsolation:true,largePayload:true});
        if(!report.historicalBreakDetected){
          const historical={label:HISTORICAL_BREAK,html:git(root,'show',`${HISTORICAL_BREAK}:index.html`)};
          const broken=await start(historical,'historical-negative-control');
          assert.equal((await broken.pull()).empty,true);
          assert.equal(broken.status,'ok','historical read advertises success');
          await assert.rejects(assertRoundTrip(broken,legacy,0,'historical unstamped client'),/upload was not acknowledged/);
          assert.equal(traces.get(broken).errors.at(-1)?.code,'permission-denied','the negative control must fail on real rules, not the harness');
          assert.equal(broken.status,'error');
          report.historicalBreakDetected=true;
        }
      }finally{
        await Promise.all(handles.map(handle=>handle.drain()));await env.cleanup();
      }
    }
  }
  console.log('Backward compatibility matrix:',JSON.stringify(report));
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Firestore emulator is required; run npm run test:compatibility');
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    // These existing discriminating tests are part of compatibility, not merely
    // optional targeted checks. Missing/renamed families require a gate update.
    const families=['RISK BACKWARD COMPATIBILITY:','RISK FIRST SIGN IN:','RISK CLOUD LOOP:',
      'RISK CLOUD RECOVERY UI:','RISK PWA recovery:'];
    const tests=fs.readFileSync(path.join(root,'tests.js'),'utf8');
    for(const name of families)assert.ok(tests.includes(`test('${name}`),`Missing required compatibility family ${name}`);
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap',`--test-name-pattern=^(${families.join('|')})`,'tests.js'],
      {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,env:process.env});
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
    assert.equal(result.status,0,'Backward compatibility gate failed');
    validateGateSummary(result.stdout||'');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
