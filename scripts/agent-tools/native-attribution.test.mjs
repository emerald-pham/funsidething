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
