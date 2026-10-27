// One bounded observer for the registered WebKit diagnostic and its fixed
// synthetic native control. Native attribution never qualifies a product fix.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(import.meta.url),
  root = path.resolve(path.dirname(here), "../.."),
  limit = 4 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const knownSource =
  '#include <stdint.h>\n#include <time.h>\n#include <unistd.h>\nvolatile uint64_t diagnosticSink=1;\n__attribute__((noinline)) void diagnosticKnownHotLoop(void){for(uint64_t i=0;i<50000000;i++)diagnosticSink=diagnosticSink*1664525+1013904223;}\nint main(void){write(1,"KNOWN_NATIVE_READY\\n",19);time_t end=time(0)+10;while(time(0)<end)diagnosticKnownHotLoop();return 0;}\n';
const clock = () => ({
  wallMs: Date.now(),
  monotonicNs: process.hrtime.bigint().toString(),
});
function write(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
function regular(file) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > limit
  )
    throw Error("Native evidence must be a bounded regular artifact.");
  return fs.readFileSync(file);
}
function macFrames(raw) {
  const text = raw.toString("utf8"),
    graph =
      text.split("Call graph:\n")[1]?.split("Total number in stack")[0] ?? "",
    threads = [...graph.matchAll(/^\s*(\d+) Thread_(\d+)/gm)].map((m) => ({
      threadId: m[2],
      sampleCount: Number(m[1]),
      firstSampleMonotonicNs: null,
      lastSampleMonotonicNs: null,
      intervalCoverage:
        "aggregate-only; individual sample timestamps unavailable",
    }));
  const functions = [
    ...new Set(
      [...graph.matchAll(/^\s+\d+ ([^\s]+)\s+\(in [^)]+\)/gm)]
        .map((m) => m[1])
        .filter(
          (name) =>
            !["???", "unknown"].includes(name) && !name.startsWith("0x"),
        ),
    ),
  ];
  return {
    pid: Number(text.match(/^Process:.*\[(\d+)\]/m)?.[1]),
    nativeDateMs: Date.parse(text.match(/^Date\/Time:\s*(.*)$/m)?.[1] ?? ""),
    sampleCount: threads.reduce((sum, t) => sum + t.sampleCount, 0),
    threadIntervals: threads,
    symbolizedFunctions: functions,
  };
}
export async function runNativeControl(output) {
  if (process.platform === "linux") return runLinuxKnownControl(output);
  const destination = path.resolve(output);
  fs.mkdirSync(destination, { recursive: true });
  if (fs.readdirSync(destination).length)
    throw Error("Native control output must be empty.");
  if (fs.realpathSync(destination).startsWith(fs.realpathSync(root) + path.sep))
    throw Error("Native evidence must stay outside the checkout.");
  const report = {
    schemaVersion: 1,
    kind: "nonqualifying-native-attribution",
    scope: "controlled-known-native-workload",
    platform: process.platform,
    architecture: process.arch,
    uid: process.getuid?.(),
    observerSha256: hash(fs.readFileSync(here)),
    sourceSha256: hash(Buffer.from(knownSource)),
    started: clock(),
    status: "unavailable",
    nativeStacksCaptured: false,
    completeAttribution: false,
    productQualification: false,
    causeProved: false,
    files: {},
    limitations: [],
    cleanup: { ownedChildExited: false },
  };
  let child, exited;
  try {
    const source = path.join(destination, "known-native.c"),
      binary = path.join(destination, "known-native");
    fs.writeFileSync(source, knownSource, { flag: "wx" });
    const compiled = spawnSync(
      "cc",
      ["-g", "-O1", "-fno-omit-frame-pointer", source, "-o", binary],
      { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    report.compiler = {
      command: ["cc", "-g", "-O1", "-fno-omit-frame-pointer"],
      exitCode: compiled.status,
      signal: compiled.signal,
      error: compiled.error?.code ?? null,
      stderr: compiled.stderr,
    };
    if (compiled.status !== 0)
      throw Error("Native controlled workload compiler unavailable.");
    report.files.source = {
      path: "known-native.c",
      sha256: hash(regular(source)),
    };
    report.files.binary = {
      path: "known-native",
      sha256: hash(regular(binary)),
    };
    child = spawn(binary, [], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    exited = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error: error.code }));
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    if (!child.pid) throw Error("Owned native workload did not start.");
    report.process = {
      pid: child.pid,
      parentPid: process.pid,
      executableSha256: report.files.binary.sha256,
      kernelIdentity: spawnSync(
        "ps",
        ["-p", String(child.pid), "-o", "pid=,ppid=,uid=,lstart="],
        { encoding: "utf8" },
      ).stdout.trim(),
    };
    const ready = await Promise.race([
      new Promise((resolve) =>
        child.stdout.once("data", (bytes) =>
          resolve(bytes.toString() === "KNOWN_NATIVE_READY\n"),
        ),
      ),
      new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);
    report.workloadReady = { observed: ready, ...clock() };
    if (!ready)
      throw Error(
        "Actual known native workload did not become ready within its fixed control deadline.",
      );
    report.captureStarted = clock();
    if (process.platform !== "darwin") {
      const available = spawnSync("perf", ["--version"], {
        encoding: "utf8",
        timeout: 3000,
        maxBuffer: 65536,
      });
      report.tool = {
        name: "perf",
        exitCode: available.status,
        error: available.error?.code ?? null,
        stdout: available.stdout,
        stderr: available.stderr,
      };
      throw Error(
        "Linux native control requires actual admitted perf capture; availability alone is not stacks.",
      );
    }
    const tool = "/usr/bin/sample",
      rawPath = path.join(destination, "sample.txt");
    report.tool = {
      name: "sample",
      path: tool,
      sha256: hash(fs.readFileSync(tool)),
    };
    const result = spawnSync(
      tool,
      [String(child.pid), "1", "1", "-mayDie", "-file", rawPath],
      {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: destination, LANG: "C" },
        timeout: 5000,
        maxBuffer: 65536,
      },
    );
    report.tool.execution = {
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.code ?? null,
      stderr: result.stderr,
    };
    report.captureFinished = clock();
    if (result.status !== 0 || !fs.existsSync(rawPath))
      throw Error("Actual native sampling unavailable.");
    const stat = fs.statSync(rawPath);
    report.truncated = stat.size > limit;
    if (report.truncated) fs.truncateSync(rawPath, limit);
    const bytes = regular(rawPath),
      observed = macFrames(bytes);
    report.files.stacks = {
      path: "sample.txt",
      sha256: hash(bytes),
      bytes: bytes.length,
    };
    Object.assign(report, observed);
    report.nativeStacksCaptured =
      observed.pid === child.pid &&
      observed.sampleCount > 0 &&
      observed.symbolizedFunctions.includes("diagnosticKnownHotLoop") &&
      !report.truncated;
    report.status = report.nativeStacksCaptured ? "partial" : "incomplete";
    report.droppedSamples = null;
    report.limitations.push(
      "Actual macOS sample aggregates native call stacks; per-sample timestamps and dropped-sample count are unavailable.",
      "This known-workload capture establishes local native symbolization only; it does not cover a Linux WebKit stall, causal app repair, or physical device.",
    );
  } catch (error) {
    report.reason = String(error.message);
    report.limitations.push(
      "Missing tools, permission, samples or symbols cannot establish an app cause.",
    );
  } finally {
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") report.cleanup.error = String(error);
      }
      const first = await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
      if (!first) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") report.cleanup.error = String(error);
        }
      }
      report.cleanup.child = first ?? (await exited);
      report.cleanup.ownedChildExited = true;
    }
    if (!child?.pid) report.cleanup.notStarted = true;
    report.finished = clock();
  }
  const reportPath = path.join(destination, "native-attribution.json");
  write(reportPath, report);
  return {
    reportPath,
    status: report.status,
    nativeStacksCaptured: report.nativeStacksCaptured,
    completeAttribution: false,
    productQualification: false,
  };
}
export function verifyNativeAttribution(reportPath, expected) {
  const report = JSON.parse(regular(reportPath)),
    directory = path.dirname(path.resolve(reportPath));
  if (report.scope === "linux-webkit-startup") {
    if (report.control) {
      const k = JSON.parse(
        fs.readFileSync(
          path.join(path.dirname(here), "native-known-control.json"),
        ),
      );
      if (
        JSON.stringify(report.control) !==
          JSON.stringify({
            sourceSha256: k.sourceSha256,
            elfSha256: k.elfSha256,
            buildId: k.buildId,
            symbol: k.symbol,
          }) ||
        report.controlCleanup?.ownedChildExited !== true
      )
        throw Error("Linux known native source/ELF/cleanup changed.");
      expected = { nativeControl: true, knownElfSha256: k.elfSha256 };
    }
    const verified = verifyBrowserNative(report, directory, expected);
    if (report.control && verified.nativeStacksCaptured && !report.symbolizedFunctions.some(symbol => symbol.split("+")[0] === report.control.symbol))
      throw Error("Linux known native control is missing its independently expected hot routine: " + report.control.symbol);
    return verified;
  }
  if (
    report.schemaVersion !== 1 ||
    report.kind !== "nonqualifying-native-attribution" ||
    report.scope !== "controlled-known-native-workload" ||
    report.observerSha256 !== hash(fs.readFileSync(here)) ||
    report.sourceSha256 !== hash(Buffer.from(knownSource)) ||
    report.completeAttribution !== false ||
    report.productQualification !== false ||
    report.causeProved !== false ||
    !(
      report.cleanup?.ownedChildExited === true ||
      (report.cleanup?.notStarted === true &&
        report.status === "unavailable" &&
        report.nativeStacksCaptured === false)
    ) ||
    !["partial", "incomplete", "unavailable"].includes(report.status)
  )
    throw Error("Native retained source/scope/cleanup identity invalid.");
  for (const row of Object.values(report.files)) {
    if (
      !["known-native.c", "known-native", "sample.txt"].includes(row.path) ||
      hash(regular(path.join(directory, row.path))) !== row.sha256
    )
      throw Error("Native retained artifact bytes changed or missing.");
  }
  if (report.nativeStacksCaptured) {
    const observed = macFrames(
      regular(path.join(directory, report.files.stacks.path)),
    );
    if (
      report.workloadReady?.observed !== true ||
      report.status !== "partial" ||
      JSON.stringify(observed.threadIntervals) !==
        JSON.stringify(report.threadIntervals) ||
      JSON.stringify(observed.symbolizedFunctions) !==
        JSON.stringify(report.symbolizedFunctions) ||
      observed.pid !== report.process.pid ||
      observed.sampleCount !== report.sampleCount ||
      !observed.symbolizedFunctions.includes("diagnosticKnownHotLoop") ||
      !Number.isFinite(observed.nativeDateMs) ||
      observed.nativeDateMs < report.captureStarted.wallMs - 100 ||
      observed.nativeDateMs > report.captureFinished.wallMs + 100 ||
      BigInt(report.captureStarted.monotonicNs) >=
        BigInt(report.captureFinished.monotonicNs) ||
      report.truncated
    )
      throw Error(
        "Native actual samples, symbolization or clock interval unavailable/inconsistent.",
      );
  }
  return {
    ok: true,
    status: report.status,
    nativeStacksCaptured: report.nativeStacksCaptured,
    completeAttribution: false,
    productQualification: false,
    limitations: report.limitations,
  };
}

const toolchainPath = path.join(path.dirname(here), "native-toolchain.json");
function toolchain() {
  return JSON.parse(fs.readFileSync(toolchainPath));
}
export function verifyNativeToolchain(directory) {
  const real = fs.realpathSync(directory),
    manifest = toolchain(),
    expected = ["manifest.json", ...manifest.files.map((r) => r.name)].sort();
  if (
    JSON.stringify(fs.readdirSync(real).sort()) !== JSON.stringify(expected) ||
    !fs
      .readFileSync(path.join(real, "manifest.json"))
      .equals(fs.readFileSync(toolchainPath))
  )
    throw Error(
      "Pinned native tool artifact inventory or governance manifest differs.",
    );
  for (const row of manifest.files) {
    const file = path.join(real, row.name),
      stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size !== row.bytes ||
      stat.size > 16 * 1024 * 1024 ||
      stat.mode & 0o222 ||
      hash(fs.readFileSync(file)) !== row.sha256
    )
      throw Error(
        "Pinned native ELF closure missing, writable or changed: " + row.name,
      );
  }
  return {
    ok: true,
    manifestSha256: hash(fs.readFileSync(toolchainPath)),
    name: manifest.name,
    packages: manifest.packages,
    files: manifest.files,
  };
}
export async function prepareNativeToolchain(directory) {
  const output = path.resolve(directory);
  fs.mkdirSync(output, { recursive: true });
  if (
    fs.readdirSync(output).length ||
    fs.realpathSync(output).startsWith(fs.realpathSync(root) + path.sep)
  )
    throw Error(
      "Native tool artifact must be empty and outside candidate source.",
    );
  const manifest = toolchain(),
    temporary = fs.mkdtempSync(
      path.join(path.dirname(output), ".native-package-"),
    );
  try {
    for (const pkg of manifest.packages) {
      const response = await fetch(pkg.url, {
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      if (!response.ok)
        throw Error("Pinned native package unavailable: " + pkg.name);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > pkg.bytes)
          throw Error("Pinned native package size changed.");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (size !== pkg.bytes || hash(bytes) !== pkg.sha256)
        throw Error("Pinned native package digest changed.");
      const deb = path.join(temporary, "package.deb");
      fs.writeFileSync(deb, bytes);
      const members = spawnSync("/usr/bin/ar", ["t", deb], {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: temporary, LANG: "C" },
        timeout: 5000,
        maxBuffer: 65536,
      });
      if (members.status !== 0)
        throw Error("Pinned package archive reader unavailable.");
      const member = members.stdout
        .trim()
        .split("\n")
        .find((s) => /^data\.tar\.(?:xz|zst|gz)$/.test(s));
      if (!member) throw Error("Pinned package data archive unavailable.");
      const data = spawnSync("/usr/bin/ar", ["p", deb, member], {
        env: { PATH: "/usr/bin:/bin", HOME: temporary, LANG: "C" },
        timeout: 5000,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (data.status !== 0)
        throw Error("Pinned package archive extraction failed.");
      const archive = path.join(temporary, "data.tar");
      fs.writeFileSync(archive, data.stdout);
      for (const row of manifest.files.filter((r) => r.package === pkg.name)) {
        const extracted = spawnSync(
          "/usr/bin/tar",
          ["-xOf", archive, "./" + row.packagePath],
          {
            env: { PATH: "/usr/bin:/bin", HOME: temporary, LANG: "C" },
            timeout: 5000,
            maxBuffer: 16 * 1024 * 1024,
          },
        );
        if (
          extracted.status !== 0 ||
          extracted.stdout.length !== row.bytes ||
          hash(extracted.stdout) !== row.sha256
        )
          throw Error("Pinned selected ELF bytes unavailable: " + row.name);
        fs.writeFileSync(path.join(output, row.name), extracted.stdout, {
          flag: "wx",
          mode: ["perf", manifest.loader].includes(row.name) ? 0o555 : 0o444,
        });
      }
    }
    fs.writeFileSync(
      path.join(output, "manifest.json"),
      fs.readFileSync(toolchainPath),
      { flag: "wx", mode: 0o444 },
    );
    return verifyNativeToolchain(output);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// Runs only inside the unchanged browser-family container. No extra capability,
// host namespace, library override for WebKit, or work outside its memory cap.
export function startBrowserNative({ output, pids, identity, membership }) {
  const directory = path.join(output, "native-attribution");
  fs.mkdirSync(directory, { recursive: true });
  const report = {
    schemaVersion: 1,
    kind: "nonqualifying-native-attribution",
    scope: "linux-webkit-startup",
    observerSha256: hash(fs.readFileSync(here)),
    identity,
    platform: process.platform,
    architecture: process.arch,
    ownerPid: process.pid,
    uid: process.getuid?.(),
    membership,
    started: clock(),
    captureStarted: clock(),
    status: "unavailable",
    nativeStacksCaptured: false,
    completeAttribution: false,
    productQualification: false,
    causeProved: false,
    files: {},
    droppedSamples: null,
    truncated: false,
    limitations: [],
    cleanup: { ownedChildExited: true },
    targetPids: pids.slice(0, 16),
    omittedTargetPids: pids.slice(16),
    clock: "CLOCK_MONOTONIC; perf --clockid mono; Node hrtime correlation",
  };
  let child,
    exited,
    stderr = Buffer.alloc(0),
    triggered = false,
    toolRoot;
  const persist = () => {
    report.finished = clock();
    fs.writeFileSync(
      path.join(directory, "native-attribution.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  };
  try {
    if (process.platform !== "linux" || process.arch !== "x64")
      throw Error(
        "Canonical native observation requires actual Linux amd64 browser container.",
      );
    toolRoot = process.env.CHAIN_DIAGNOSTIC_TOOLS;
    if (toolRoot !== "/opt/chain-native-tools")
      throw Error("Reviewed read-only native tool artifact mount unavailable.");
    report.toolchain = verifyNativeToolchain(toolRoot);
    const version = spawnSync(
      path.join(toolRoot, toolchain().loader),
      ["--library-path", toolRoot, path.join(toolRoot, "perf"), "--version"],
      {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C" },
        timeout: 3000,
        maxBuffer: 65536,
      },
    );
    report.actualToolVersion = {
      exitCode: version.status,
      stdout: version.stdout,
      stderr: version.stderr,
      error: version.error?.code ?? null,
    };
    if (version.status !== 0)
      throw Error(
        "Pinned actual perf executable cannot start in the original image.",
      );
    report.kernel = {
      release: fs.readFileSync("/proc/sys/kernel/osrelease", "utf8").trim(),
      perfEventParanoid: fs
        .readFileSync("/proc/sys/kernel/perf_event_paranoid", "utf8")
        .trim(),
      capabilities: fs
        .readFileSync("/proc/self/status", "utf8")
        .split("\n")
        .filter((l) => /^Cap(?:Inh|Prm|Eff|Bnd|Amb):|^NoNewPrivs:/.test(l)),
      cgroup: fs.readFileSync("/proc/self/cgroup", "utf8").trim(),
    };
    if (report.kernel.cgroup !== membership)
      throw Error("Native observer escaped actual browser cgroup.");
    report.targets = report.targetPids.map((pid) => ({
      pid,
      start: fs.readFileSync(`/proc/${pid}/stat`, "utf8"),
      executable: fs.readlinkSync(`/proc/${pid}/exe`),
      executableSha256: hash(fs.readFileSync(`/proc/${pid}/exe`)),
      maps: fs.readFileSync(`/proc/${pid}/maps`, "utf8").slice(0, 65536),
      mapsCoverage:
        "bounded first 65536 characters; perf retained mmap records carry its own coverage",
    }));
    const manifest = toolchain(),
      args = [
        "--library-path",
        toolRoot,
        path.join(toolRoot, manifest.executable),
        "record",
        "-e",
        "cpu-clock:u",
        "-F",
        "99",
        "--call-graph",
        "fp",
        "--clockid",
        "mono",
        "--overwrite",
        "--switch-output=signal",
        "--switch-max-files=2",
        "--mmap-pages",
        "16",
        "--max-size",
        "1M",
        "--pid",
        report.targetPids.join(","),
        "-o",
        path.join(directory, "perf.data"),
      ];
    report.command = [path.join(toolRoot, manifest.loader), ...args];
    report.buffer = {
      pages: 16,
      pageBytes: 4096,
      frequency: 99,
      maxFiles: 2,
      maxSampleDataBytesPerFile: 1048576,
      scope:
        "perf ring/pages and profiler execute in the original browser-family cgroup",
    };
    child = spawn(report.command[0], args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C" },
    });
    exited = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error: error.code }));
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    report.cleanup.ownedChildExited = false;
    child.stderr.on("data", (b) => {
      if (stderr.length + b.length > 65536) report.stderrTruncated = true;
      if (stderr.length < 65536)
        stderr = Buffer.concat([stderr, b]).subarray(0, 65536);
    });
    if (child.pid)
      report.sampler = {
        pid: child.pid,
        start: fs.readFileSync(`/proc/${child.pid}/stat`, "utf8"),
        membership: fs.readFileSync(`/proc/${child.pid}/cgroup`, "utf8").trim(),
      };
    if (report.sampler?.membership !== membership)
      throw Error("Native sampler actual cgroup identity invalid.");
    report.status = "running";
  } catch (error) {
    report.reason = error.message;
    report.limitations.push(
      "Actual tool, permission or process identity unavailable; no attribution is inferred.",
    );
  }
  return {
    trigger(label) {
      if (triggered) return;
      triggered = true;
      report.trigger = { label, ...clock() };
      if (child?.pid)
        try {
          child.kill("SIGUSR2");
        } catch (error) {
          report.trigger.error = error.code;
        }
    },
    async finish() {
      if (!triggered) this.trigger("owner-cleanup-without-startup-trigger");
      if (child) {
        try {
          child.kill("SIGINT");
        } catch {}
        let result = await Promise.race([
          exited,
          new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (!result) {
          try {
            child.kill("SIGKILL");
          } catch {}
          result = await exited;
          report.cleanup.escalated = true;
        }
        report.cleanup = { ...report.cleanup, ownedChildExited: true, result };
      }
      report.captureFinished = clock();
      report.stderr = stderr.toString();
      let retained = 0,
        text = "";
      for (const file of fs
        .readdirSync(directory)
        .filter((n) => /^perf\.data(?:\.[0-9]+)?$/.test(n))
        .sort()) {
        const filename = path.join(directory, file),
          stat = fs.statSync(filename);
        if (stat.size > limit || retained + stat.size > limit) {
          report.truncated = true;
          fs.unlinkSync(filename);
          continue;
        }
        retained += stat.size;
        report.files[file] = {
          path: file,
          sha256: hash(fs.readFileSync(filename)),
          bytes: stat.size,
        };
        if (!toolRoot) continue;
        const manifest = toolchain(),
          script = spawnSync(
            path.join(toolRoot, manifest.loader),
            [
              "--library-path",
              toolRoot,
              path.join(toolRoot, manifest.executable),
              "script",
              "--ns",
              "--show-lost-events",
              "--max-stack",
              "32",
              "-F",
              "comm,pid,tid,time,event,ip,sym,dso",
              "-i",
              filename,
            ],
            {
              encoding: "utf8",
              env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C" },
              timeout: 5000,
              maxBuffer: 1024 * 1024,
            },
          );
        report.symbolizer ??= [];
        report.symbolizer.push({
          file,
          exitCode: script.status,
          signal: script.signal,
          error: script.error?.code ?? null,
          stderr: script.stderr,
        });
        if (script.error?.code === "ENOBUFS") report.truncated = true;
        if (script.status === 0) text += script.stdout;
      }
      if (Buffer.byteLength(text) > 1024 * 1024) {
        text = text.slice(0, 1024 * 1024);
        report.truncated = true;
      }
      fs.writeFileSync(path.join(directory, "stacks.txt"), text);
      report.files.stacks = {
        path: "stacks.txt",
        sha256: hash(Buffer.from(text)),
        bytes: Buffer.byteLength(text),
      };
      const observed = perfFrames(text);
      Object.assign(report, observed);
      report.nativeStacksCaptured =
        observed.sampleCount > 0 &&
        observed.symbolizedFunctions.length > 0 &&
        !report.truncated;
      report.status = report.nativeStacksCaptured
        ? "partial"
        : report.reason
          ? "unavailable"
          : "incomplete";
      report.limitations.push(
        "Captured intervals contain only observed samples; overwritten prehistory, unsampled threads, short-lived tasks and missing frame pointers or symbols remain gaps.",
        "No native hot routine or thread alone proves triggering app work or a causal repair.",
      );
      persist();
      return {
        path: "native-attribution/native-attribution.json",
        sha256: hash(
          fs.readFileSync(path.join(directory, "native-attribution.json")),
        ),
        status: report.status,
        nativeStacksCaptured: report.nativeStacksCaptured,
        completeAttribution: false,
      };
    },
  };
}
function perfFrames(text) {
  const intervals = new Map(),
    symbols = new Set();
  let sampleCount = 0;
  for (const line of text.split("\n")) {
    const match = line.match(
      /^\s*.*?\b(\d+)[/\s]+(\d+)\s+(\d+\.\d{9}):\s+\S+:/,
    );
    if (match) {
      sampleCount++;
      const key = match[1] + ":" + match[2],
        ns = (
          BigInt(match[3].split(".")[0]) * 1000000000n +
          BigInt(match[3].split(".")[1])
        ).toString(),
        row = intervals.get(key) ?? {
          pid: Number(match[1]),
          threadId: Number(match[2]),
          sampleCount: 0,
          firstSampleMonotonicNs: ns,
          lastSampleMonotonicNs: ns,
        };
      row.sampleCount++;
      row.lastSampleMonotonicNs = ns;
      intervals.set(key, row);
    }
    const symbol = line.match(/^\s*[a-f0-9]+\s+(.+?)\s+\(([^)]+)\)\s*$/i)?.[1];
    if (symbol && !/^(?:\[unknown\]|unknown|0x|\?\?\?)/.test(symbol))
      symbols.add(symbol);
  }
  return {
    sampleCount,
    threadIntervals: [...intervals.values()],
    symbolizedFunctions: [...symbols],
    lostEventRecords: (text.match(/PERF_RECORD_LOST/g) ?? []).length,
  };
}
function verifyBrowserNative(report, directory, expected) {
  if (
    !expected ||
    report.observerSha256 !== hash(fs.readFileSync(here)) ||
    report.platform !== "linux" ||
    report.architecture !== "x64" ||
    report.completeAttribution !== false ||
    report.productQualification !== false ||
    report.causeProved !== false ||
    report.cleanup?.ownedChildExited !== true
  )
    throw Error("Native Linux source, runtime or cleanup binding incomplete.");
  for (const [key, value] of Object.entries(expected))
    if (report.identity?.[key] !== value)
      throw Error("Native actual application/run identity changed: " + key);
  if (
    report.toolchain &&
    JSON.stringify(report.toolchain) !==
      JSON.stringify({
        ok: true,
        manifestSha256: hash(fs.readFileSync(toolchainPath)),
        name: toolchain().name,
        packages: toolchain().packages,
        files: toolchain().files,
      })
  )
    throw Error("Native actual pinned package/ELF closure differs.");
  let retained = 0;
  for (const row of Object.values(report.files)) {
    if (!/^(?:perf\.data(?:\.[0-9]+)?|stacks\.txt)$/.test(row.path))
      throw Error("Unknown native retained artifact.");
    const bytes = regular(path.join(directory, row.path));
    retained += bytes.length;
    if (
      retained > limit + 1024 * 1024 ||
      bytes.length !== row.bytes ||
      hash(bytes) !== row.sha256
    )
      throw Error("Native retained bytes missing, truncated or changed.");
  }
  const raw = report.files.stacks
    ? regular(path.join(directory, report.files.stacks.path)).toString()
    : "";
  const actual = perfFrames(raw);
  for (const key of [
    "sampleCount",
    "threadIntervals",
    "symbolizedFunctions",
    "lostEventRecords",
  ])
    if (JSON.stringify(actual[key]) !== JSON.stringify(report[key]))
      throw Error("Native retained stack interpretation changed.");
  if (report.nativeStacksCaptured) {
    if (
      !report.toolchain ||
      report.truncated ||
      !actual.sampleCount ||
      !actual.symbolizedFunctions.length ||
      report.status !== "partial" ||
      !report.trigger ||
      !report.targets?.length
    )
      throw Error("Native Linux samples/symbols/target/trigger unavailable.");
    const start = BigInt(report.captureStarted.monotonicNs),
      end = BigInt(report.captureFinished.monotonicNs),
      trigger = BigInt(report.trigger.monotonicNs);
    if (start >= end || trigger < start || trigger > end)
      throw Error("Native Linux clock correlation invalid.");
    for (const row of actual.threadIntervals)
      if (
        BigInt(row.firstSampleMonotonicNs) < start ||
        BigInt(row.lastSampleMonotonicNs) > end ||
        BigInt(row.firstSampleMonotonicNs) > BigInt(row.lastSampleMonotonicNs)
      )
        throw Error("Native Linux sample clock window invalid.");
  } else if (!["incomplete", "unavailable"].includes(report.status))
    throw Error("Missing native attribution cannot be relabelled captured.");
  return {
    ok: true,
    status: report.status,
    nativeStacksCaptured: report.nativeStacksCaptured,
    completeAttribution: false,
    productQualification: false,
    reason: report.reason ?? null,
    sampleCount: actual.sampleCount,
    threadIntervals: actual.threadIntervals,
    limitations: report.limitations,
  };
}
async function runLinuxKnownControl(output) {
  const directory = path.resolve(output);
  fs.mkdirSync(directory, { recursive: true });
  if (
    fs.readdirSync(directory).length ||
    fs.realpathSync(directory).startsWith(fs.realpathSync(root) + path.sep)
  )
    throw Error("Known Linux native control must use empty external evidence.");
  const known = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(here), "native-known-control.json"),
      ),
    ),
    bytes = Buffer.from(known.elfBase64, "base64");
  if (hash(bytes) !== known.elfSha256)
    throw Error("Known native ELF source delivery changed.");
  const binary = path.join(directory, "known-native");
  fs.writeFileSync(binary, bytes, { flag: "wx", mode: 0o555 });
  const child = spawn(binary, [], { stdio: "ignore" }),
    exited = new Promise((resolve) => {
      child.on("error", (error) => resolve({ error: error.code }));
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
  let collector, result, cleanup;
  try {
    if (!child.pid)
      throw Error("Actual fixed native control failed to launch.");
    collector = startBrowserNative({
      output: directory,
      pids: [child.pid],
      identity: { nativeControl: true, knownElfSha256: known.elfSha256 },
      membership: fs.readFileSync("/proc/self/cgroup", "utf8").trim(),
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    collector.trigger("controlled-known-native-workload");
    result = await collector.finish();
  } finally {
    if (child.pid)
      try {
        child.kill("SIGTERM");
      } catch {}
    cleanup = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!cleanup) {
      try {
        child.kill("SIGKILL");
      } catch {}
      cleanup = await exited;
    }
  }
  const reportPath = path.join(directory, result.path),
    report = JSON.parse(fs.readFileSync(reportPath));
  report.control = {
    sourceSha256: known.sourceSha256,
    elfSha256: known.elfSha256,
    buildId: known.buildId,
    symbol: known.symbol,
  };
  report.controlCleanup = { ownedChildExited: true, result: cleanup };
  if (
    report.nativeStacksCaptured &&
    !report.symbolizedFunctions.some((s) => s.split("+")[0] === known.symbol)
  ) {
    report.nativeStacksCaptured = false;
    report.status = "incomplete";
    report.reason =
      "Actual native control samples did not symbolize the independently expected hot loop.";
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  return {
    reportPath,
    status: report.status,
    nativeStacksCaptured: report.nativeStacksCaptured,
    completeAttribution: false,
    productQualification: false,
  };
}
