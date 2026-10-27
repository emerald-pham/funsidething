import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const repo = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
  cli = path.join(repo, "scripts/release-evidence.mjs");
function command(op, arg) {
  return spawnSync(process.execPath, [cli, op, arg], {
    cwd: repo,
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 8 * 1024 * 1024,
  });
}
test("the actual native capture consumer retains symbolized stacks for its fixed known workload", (t) => {
  const output = fs.mkdtempSync(
    path.join(os.tmpdir(), "known-native-control-"),
  );
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const captured = command("diagnostic-native-control", output);
  assert.equal(captured.status, 0, captured.stderr);
  const report = JSON.parse(
    fs.readFileSync(JSON.parse(captured.stdout).reportPath),
  );
  if (process.platform === "linux" && !process.env.CHAIN_DIAGNOSTIC_TOOLS) {
    assert.equal(report.status, "unavailable");
    assert.equal(report.nativeStacksCaptured, false);
    assert.match(report.reason, /tool artifact mount unavailable/);
    const verified = command(
      "diagnostic-native-verify",
      JSON.parse(captured.stdout).reportPath,
    );
    assert.equal(verified.status, 0, verified.stderr);
    return;
  }
  assert.equal(
    report.nativeStacksCaptured,
    true,
    "real available native sampling must retain the known native hot routine: " +
      JSON.stringify(report),
  );
  assert.ok(report.symbolizedFunctions.includes("diagnosticKnownHotLoop"));
  assert.ok(report.sampleCount > 0);
  if (process.platform === "darwin")
    assert.equal(
      report.workloadReady?.observed,
      true,
      "the actual fixed workload must reach its loop before the native sampler starts",
    );
  assert.equal(report.cleanup.ownedChildExited, true);
  const verified = command(
    "diagnostic-native-verify",
    JSON.parse(captured.stdout).reportPath,
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(
    JSON.parse(verified.stdout).ok,
    true,
    "a fresh process verifies the retained actual native evidence",
  );
});

test("fresh native verification rejects invented complete attribution and retained source, sample, clock and symbol loss", (t) => {
  const output = fs.mkdtempSync(
    path.join(os.tmpdir(), "native-missing-control-"),
  );
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const captured = command("diagnostic-native-control", output);
  assert.equal(captured.status, 0, captured.stderr);
  const reportPath = JSON.parse(captured.stdout).reportPath,
    original = JSON.parse(fs.readFileSync(reportPath));
  if (process.platform === "linux" && !process.env.CHAIN_DIAGNOSTIC_TOOLS) {
    assert.equal(original.status, "unavailable");
    original.completeAttribution = true;
    fs.writeFileSync(reportPath, JSON.stringify(original));
    assert.notEqual(command("diagnostic-native-verify", reportPath).status, 0);
    return;
  }
  assert.equal(original.nativeStacksCaptured, true, JSON.stringify(original));
  const complete = { ...original, completeAttribution: true };
  fs.writeFileSync(reportPath, JSON.stringify(complete));
  const upgraded = command("diagnostic-native-verify", reportPath);
  assert.notEqual(
    upgraded.status,
    0,
    "aggregate or missing native evidence cannot be relabelled complete attribution",
  );
  for (const change of [
    (r) => {
      r.sourceSha256 = "0".repeat(64);
    },
    (r) => {
      r.captureStarted = { wallMs: Date.now() + 100000, monotonicNs: "1" };
    },
    (r) => {
      r.truncated = true;
    },
  ]) {
    const value = structuredClone(original);
    change(value);
    fs.writeFileSync(reportPath, JSON.stringify(value));
    assert.notEqual(
      command("diagnostic-native-verify", reportPath).status,
      0,
      "fresh verifier rejects source/clock/truncation tamper",
    );
  }
  if (original.files.stacks) {
    const stackPath = path.join(output, original.files.stacks.path),
      raw = fs.readFileSync(stackPath),
      unsymbolized = Buffer.from(
        raw.toString().replaceAll("diagnosticKnownHotLoop", "???"),
      ),
      changed = structuredClone(original);
    fs.writeFileSync(stackPath, unsymbolized);
    changed.files.stacks.sha256 = createHash("sha256")
      .update(unsymbolized)
      .digest("hex");
    fs.writeFileSync(reportPath, JSON.stringify(changed));
    assert.notEqual(
      command("diagnostic-native-verify", reportPath).status,
      0,
      "actual retained stacks with missing symbols cannot qualify attribution",
    );
    fs.writeFileSync(stackPath, raw);
    fs.writeFileSync(reportPath, JSON.stringify(original));
    fs.unlinkSync(path.join(output, original.files.stacks.path));
    assert.notEqual(
      command("diagnostic-native-verify", reportPath).status,
      0,
      "missing actual stacks cannot become attribution",
    );
  }
});

test("the public native toolchain verifier refuses a missing pinned ELF closure", (t) => {
  const output = fs.mkdtempSync(
    path.join(os.tmpdir(), "native-closure-control-"),
  );
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const result = command("diagnostic-native-toolchain-verify", output);
  assert.notEqual(
    result.status,
    0,
    "a caller-selected empty directory cannot become the reviewed Linux profiler or its library closure",
  );
});

test("the fixed Linux native control reproduces its reviewed executable and independently named hot loop", () => {
  const known = JSON.parse(
      fs.readFileSync(
        path.join(repo, "scripts/agent-tools/native-known-control.json"),
      ),
    ),
    built = spawnSync(
      "python3",
      [path.join(repo, "scripts/agent-tools/build-native-known-control.py")],
      { cwd: repo, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
    );
  assert.equal(built.status, 0, built.stderr);
  const observed = JSON.parse(built.stdout);
  assert.equal(observed.elfSha256, known.elfSha256);
  assert.equal(observed.buildId, known.buildId);
  assert.equal(observed.sourceSha256, known.sourceSha256);
  assert.equal(observed.symbol, "diagnosticKnownHotLoop");
  assert.equal(
    observed.textHex,
    "49c7c4010000004d69e40d6619004981c45ff36e3cebf0",
    "fixed amd64 code initializes r12, runs the named integer recurrence and branches to that same loop",
  );
  const binary = Buffer.from(observed.elfBase64, "base64");
  assert.equal(binary.readUInt16LE(18), 62);
  assert.equal(binary.readBigUInt64LE(24), 0x401000n);
  assert.equal(
    binary.subarray(0x1000, 0x1000 + 23).toString("hex"),
    observed.textHex,
  );
  assert.ok(binary.includes(Buffer.from("diagnosticKnownHotLoop\0")));
  assert.equal(
    createHash("sha256").update(binary).digest("hex"),
    known.elfSha256,
  );
});


test('fresh Linux known-control verification refuses self-consistent loader-only retained evidence',async t=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'linux-native-verifier-control-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),known=JSON.parse(fs.readFileSync(path.join(repo,'scripts/agent-tools/native-known-control.json'))),manifestBytes=fs.readFileSync(path.join(repo,'scripts/agent-tools/native-toolchain.json')),manifest=JSON.parse(manifestBytes),reportPath=path.join(output,'native-attribution.json');
 const retained=symbol=>{
  const stacks=Buffer.from('known-native 41/41 2.000000000: cycles:u:\n    401000 '+symbol+' (/controlled/known-native)\n');fs.writeFileSync(path.join(output,'stacks.txt'),stacks);
  const report={schemaVersion:1,kind:'nonqualifying-native-attribution',scope:'linux-webkit-startup',platform:'linux',architecture:'x64',observerSha256:hash(fs.readFileSync(path.join(repo,'scripts/agent-tools/native-attribution.mjs'))),identity:{nativeControl:true,knownElfSha256:known.elfSha256},control:{sourceSha256:known.sourceSha256,elfSha256:known.elfSha256,buildId:known.buildId,symbol:known.symbol},controlCleanup:{ownedChildExited:true},cleanup:{ownedChildExited:true},toolchain:{ok:true,manifestSha256:hash(manifestBytes),name:manifest.name,packages:manifest.packages,files:manifest.files},files:{stacks:{path:'stacks.txt',bytes:stacks.length,sha256:hash(stacks)}},sampleCount:1,threadIntervals:[{pid:41,threadId:41,sampleCount:1,firstSampleMonotonicNs:'2000000000',lastSampleMonotonicNs:'2000000000'}],symbolizedFunctions:[symbol],lostEventRecords:0,status:'partial',nativeStacksCaptured:true,completeAttribution:false,productQualification:false,causeProved:false,truncated:false,captureStarted:{monotonicNs:'1000000000'},captureFinished:{monotonicNs:'3000000000'},trigger:{monotonicNs:'2000000000'},targets:[{pid:41,threadId:41}],limitations:['Controlled retained perf-text verifier witness; no Linux execution or actual native-frame claim.']};fs.writeFileSync(reportPath,JSON.stringify(report));return report;
 };
 retained('diagnosticKnownHotLoop');const positive=command('diagnostic-native-verify',reportPath);assert.equal(positive.status,0,positive.stderr);assert.equal(JSON.parse(positive.stdout).nativeStacksCaptured,true);
 const loader=retained('_dl_start');const refused=command('diagnostic-native-verify',reportPath);assert.notEqual(refused.status,0,'Fresh known-control verification must require its independently expected diagnosticKnownHotLoop even when raw text, hashes and summary agree');assert.match(refused.stderr,/known.*(?:symbol|routine)|diagnosticKnownHotLoop/i);
 delete loader.control;delete loader.controlCleanup;loader.identity={application:'controlled-partial'};fs.writeFileSync(reportPath,JSON.stringify(loader));const {verifyNativeAttribution}=await import('./native-attribution.mjs');assert.equal(verifyNativeAttribution(reportPath,{application:'controlled-partial'}).nativeStacksCaptured,true,'Partial app attribution may retain available routines without claiming the independently fixed known control or a causal repair');
 t.diagnostic('Controlled durable verifier mutation only; expected source/ELF metadata is the approved known control. Actual Linux/perf capture remains unexecuted here.');
});
