import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from './button-safety-contract.mjs';

const COMMIT='b176026825e4f9539780f745fe60e09cf348d288';
const TREE='27e293d0fa9aae62a906b36dc984bd0ef184f956';
const MANIFEST='scripts/scenery-source-fixture.json';
const TOOL_FILES=['tests.js','scripts/button-safety-native.mjs','scripts/scenery-source-fixture.mjs','scripts/scenery-source-fixture.json','scripts/early-ci-harness-source.json'];

// One immutable source for the two saved scenery contracts, never a source selector.
export function savedSceneryApplication(repo){
 const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:32*1024*1024});
 assert.equal(git('rev-parse',COMMIT+'^{tree}').toString().trim(),TREE,'Exact saved scenery tree required');
 const manifest=JSON.parse(fs.readFileSync(path.join(repo,MANIFEST)));
 assert.deepEqual(Object.keys(manifest).sort(),['schemaVersion','id','commit','tree','originalHarnessCommit','assets'].sort());
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.id,'saved-scenery-b176');assert.equal(manifest.commit,COMMIT);assert.equal(manifest.tree,TREE);assert.equal(manifest.originalHarnessCommit,'9b5bc1c9d5a87fed022a17706bbb0e69e94757b1');
 const runtime=JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'))).requiredRuntimeAssets;
 const files=git('ls-tree','-r','--name-only',COMMIT).toString().trim().split('\n').filter(file=>file!=='tests.js'&&!file.startsWith('scripts/')&&(/\.(?:html|js|css|svg|png|webmanifest)$/.test(file)||Object.hasOwn(runtime,file)));
 const sources=new Map(files.map(file=>[file,git('show',COMMIT+':'+file)])),assets=Object.fromEntries([...sources].map(([file,bytes])=>[file,digest(bytes)]));
 assert.deepEqual(assets,manifest.assets,'Complete immutable saved application inventory required');
 const tooling={commit:git('rev-parse','HEAD').toString().trim(),tree:git('rev-parse','HEAD^{tree}').toString().trim(),assets:Object.fromEntries(TOOL_FILES.map(file=>[file,digest(fs.readFileSync(path.join(repo,file)))]))};
 return {sources,binding:{...manifest,tooling,coverage:'Two saved scenery harness consumers only; no current-app paint or required mobile acceptance'}};
}

export function verifySceneryFixtureReport(report,{repo,candidateCommit,candidateTree}={}){
 assert.equal(report.kind,'button-scenery-fixture');assert.equal(report.engine,'webkit');
 assert.equal(report.sourceProfile,undefined,'Saved scenery cannot use canonical mobile admission');
 const expected=savedSceneryApplication(repo).binding;
 assert.deepEqual(report.appFixture,expected,'Saved fixture and current tooling identities must both match');
 assert.deepEqual(report.assets,expected.assets,'Every served fixture asset must match the immutable app');
 for(const [key,value]of Object.entries({candidateCommit,candidateTree}))if(value!==undefined)assert.equal(report[key],value,'Scenery tooling checkout '+key);
 assert.equal(report.candidateCommit,expected.tooling.commit);assert.equal(report.candidateTree,expected.tooling.tree);
 return report.appFixture;
}
