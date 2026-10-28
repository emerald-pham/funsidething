import { diagnosticMobileSource } from "./diagnostic-receipt.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  recordReleaseEvidence,
  deriveReleaseReviewPlan,
} from "../release-evidence.mjs";
const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
  cli = path.join(repository, "scripts/release-evidence.mjs"),
  checkpoint = path.join(repository, "scripts/agent-tools/checkpoint.mjs");
const frozen = "b176026825e4f9539780f745fe60e09cf348d288",
  observer = "c899e5e983cd756152c1d0c8057ffe8455e80956",
  hash = (b) => createHash("sha256").update(b).digest("hex");
function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function seedRun(f, runId) {
  const state = JSON.parse(fs.readFileSync(f.remoteFile));
  state.run = {
    id: Number(runId),
    head_sha: f.governance ?? f.source,
    head_branch: f.governance ? "main" : "diagnose/fixture",
    run_attempt: 1,
    status: "in_progress",
    conclusion: null,
    event: "workflow_dispatch",
    name: "Nonqualifying source-bound diagnostic",
    path: ".github/workflows/diagnostic.yml",
  };
  fs.writeFileSync(f.remoteFile, JSON.stringify(state));
}
function command(f, op, ...args) {
  if (op.startsWith("diagnostic-ci-")) args = ["--repo", f.repo, ...args];
  return spawnSync(
    f.pathNode ? "node" : process.execPath,
    [f.cli ?? cli, op, ...args],
    {
      cwd: f.repo,
      env: { ...process.env, ...f.env },
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-receipt-")),
    repo = path.join(root, "repo");
  git(repository, "clone", "-q", "--shared", "--no-checkout", repository, repo);
  git(repo, "checkout", "-q", observer);
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.test");
  git(
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/emerald-pham/funsidething.git",
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reportBase = path.join(root, "synthetic-frozen-review.md");
  fs.writeFileSync(
    reportBase,
    "Synthetic isolated frozen-source review fixture, not a real product approval.",
  );
  const reportHash = hash(fs.readFileSync(reportBase)),
    base = "6c67fb0c9988d3e578579c7bb23a8ed0731aac3f",
    planBase = deriveReleaseReviewPlan(repo, frozen, base),
    now = new Date().toISOString(),
    reviewBase = (task) => ({
      task,
      reviewedSha: frozen,
      outcome: "approved",
      completedAt: now,
      summary:
        "Synthetic full frozen-source review fixture for public validator coverage.",
      scope: {
        fullDiff: true,
        relevantTests: true,
        userVisibleAndDataSafety: true,
      },
      evidencePath: reportBase,
      evidenceSha256: reportHash,
    });
  recordReleaseEvidence(repo, {
    schemaVersion: 2,
    candidate: {
      commitSha: frozen,
      treeSha: git(repo, "rev-parse", frozen + "^{tree}"),
      baseSha: base,
    },
    ownerReview: {
      ...reviewBase("fixture-base-owner"),
      scope: {
        fullDiff: true,
        rationale:
          "Synthetic fixture owner inspects every frozen source change.",
      },
    },
    independentReview: reviewBase("fixture-base-code"),
    faqReview: reviewBase("fixture-base-faq"),
    specialistReview: {
      ...reviewBase("fixture-base-risk"),
      domains: planBase.specialistDomains,
      memoryScope: Object.fromEntries(
        ["memory", "cloud", "sync"].map((domain) => [
          domain,
          {
            affected: false,
            rationale:
              "Synthetic frozen fixture preserves this domain without claiming a product result.",
            tests:
              domain === "memory" ? ["synthetic preservation fixture"] : [],
          },
        ]),
      ),
      sources: [{ path: reportBase, sha256: reportHash }],
    },
  });
  const files = [
    "scripts/release-evidence.mjs",
    "scripts/agent-tools/diagnostic-receipt.mjs",
    "scripts/agent-tools/diagnostic-hosted-policy.mjs",
    "scripts/agent-tools/native-attribution.mjs",
    "scripts/agent-tools/native-toolchain.json",
    "scripts/agent-tools/native-known-control.json",
    "scripts/agent-tools/build-native-known-control.py",
    "scripts/agent-tools/checkpoint-progress.mjs",
    "scripts/agent-tools/checkpoint.mjs",
    "scripts/agent-tools/record-run.mjs",
    "scripts/agent-tools/workflow-validator.mjs",
    "scripts/agent-tools/preflight.mjs",
    "scripts/agent-tools/qualification-contracts.mjs",
    "scripts/test-groups.mjs",
    "scripts/agent-tools/ci-pass-reuse.mjs",
    ".github/workflows/data-safety.yml",
    ".github/workflows/diagnostic.yml",
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.copyFileSync(path.join(repository, file), path.join(repo, file));
  }
  // Frozen package scripts deliberately stay unchanged. Reuse only the verified
  // external validator cache, never untracked JavaScript command dependencies.
  const validatorCache="node_modules/.cache/funsidething/actionlint";
  fs.mkdirSync(path.dirname(path.join(repo,validatorCache)),{recursive:true});
  fs.cpSync(path.join(repository,validatorCache),path.join(repo,validatorCache),{recursive:true});
  const mobile = path.join(repo, "scripts/button-safety-mobile-memory.mjs");
  fs.writeFileSync(mobile, diagnosticMobileSource(repo));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const issues = {
    286: {
      number: 286,
      url: "https://github.com/emerald-pham/funsidething/issues/286",
      body: "## Parent\n\n#278",
      comments: [],
      updatedAt: "2026-10-27T00:00:00Z",
    },
    278: {
      number: 278,
      url: "https://github.com/emerald-pham/funsidething/issues/278",
      body: "Bound diagnostic parent authority",
      comments: [],
      updatedAt: "2026-10-27T00:00:00Z",
    },
  };
  const remoteFile = path.join(root, "remote.json");
  fs.writeFileSync(
    remoteFile,
    JSON.stringify({
      issues,
      refs: {},
      blobs: {},
      trees: {},
      commits: {},
      dispatches: [],
      publications: 0,
      requests: [],
    }),
  );
  const gh = path.join(bin, "gh");
  fs.writeFileSync(
    gh,
    `#!${process.execPath}\nrequire(${JSON.stringify(path.join(repository, "scripts/agent-tools/diagnostic-gh-fixture.cjs"))});`,
  );
  fs.chmodSync(gh, 0o700);
  const npm = path.join(bin, "npm");
  fs.writeFileSync(
    npm,
    `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(path.join(root, "dependency-installs.txt"))},JSON.stringify(process.argv.slice(2))+'\\n');`,
  );
  fs.chmodSync(npm, 0o700);
  const env = {
    PATH: bin + path.delimiter + process.env.PATH,
    DIAGNOSTIC_FAKE_STATE: remoteFile,
    GITHUB_RUN_ID: "",
    GITHUB_RUN_ATTEMPT: "",
    GITHUB_EVENT_NAME: "",
    GITHUB_REF: "",
    GITHUB_REPOSITORY: "",
    GITHUB_SHA: "",
    GITHUB_WORKFLOW_SHA: "",
    GITHUB_WORKFLOW_REF: "",
  };
  const cp = (op, ...args) =>
    spawnSync(
      process.execPath,
      [checkpoint, op, "--repo", repo, "--task", "286", ...args],
      { env: { ...process.env, ...env }, encoding: "utf8", timeout: 30000 },
    );
  assert.equal(cp("prepare").status, 0);
  git(repo, "add", ".");
  git(
    repo,
    "commit",
    "-qm",
    "Exact canonical diagnostic with trusted execution tools",
  );
  const source = git(repo, "rev-parse", "HEAD"),
    tree = git(repo, "rev-parse", "HEAD^{tree}"),
    plan = path.join(root, "plan.json"),
    launch = { command: "diagnostic-workflow", args: [source] };
  fs.writeFileSync(
    plan,
    JSON.stringify({
      base: frozen,
      gate: "required-1gb-attribution",
      nextAction:
        "Obtain attributed native evidence within one canonical attempt",
      owner: "fixture-owner",
      allocation: "fixture-diagnostic-slot",
      hypothesis:
        "The canonical observer attributes the existing required gate",
      observation: { expectedExitCode: 0, stdoutIncludes: "attributed" },
      allowance: 2,
      sourcePaths: ["scripts/button-safety-mobile-memory.mjs"],
      entrypoints: ["scripts/button-safety-mobile-memory.mjs"],
      launch,
    }),
  );
  assert.equal(cp("start", "--input", plan).status, 0);
  const admit = path.join(root, "admit.json");
  fs.writeFileSync(admit, JSON.stringify({ ...launch, request: "first" }));
  const admitted = cp(
    "admit",
    "--input",
    admit,
    "--record",
    path.join(root, "terminal-result.json"),
  );
  assert.equal(admitted.status, 0, admitted.stderr);
  const attempt = JSON.parse(admitted.stdout).attempt,
    bundle = path.join(root, "admission.json");
  assert.equal(
    cp("export-public", "--attempt", attempt.id, "--record", bundle).status,
    0,
  );
  const remote = JSON.parse(fs.readFileSync(remoteFile));
  remote.source = source;
  remote.tree = tree;
  fs.writeFileSync(remoteFile, JSON.stringify(remote));
  const artifact = path.join(root, "rendered-artifact.txt");
  fs.writeFileSync(
    artifact,
    "Independent rendered review fixture for frozen source only.",
  );
  const rendered = path.join(root, "rendered.json");
  fs.writeFileSync(
    rendered,
    JSON.stringify({
      schemaVersion: 1,
      reviewedSha: frozen,
      treeSha: git(repo, "rev-parse", frozen + "^{tree}"),
      outcome: "approved",
      task: "fixture-rendered-reviewer",
      summary:
        "Independent unchanged rendered evidence for the frozen candidate.",
      artifacts: [
        { evidencePath: artifact, sha256: hash(fs.readFileSync(artifact)) },
      ],
    }),
  );
  const report = path.join(root, "instrumentation-review.txt");
  fs.writeFileSync(
    report,
    "Exact observer instrumentation, security, memory and release-process review.",
  );
  const review = (task) => ({
    task,
    reviewedSha: source,
    outcome: "approved",
    evidencePath: report,
    sha256: hash(fs.readFileSync(report)),
    domains: ["memory-cloud-sync", "release-process", "security-deployment"],
  });
  const input = {
    schemaVersion: 1,
    kind: "nonqualifying-diagnostic",
    candidate: { commitSha: source, treeSha: tree, baseSha: frozen },
    owner: "fixture-owner",
    admissionPath: bundle,
    admissionSha256: hash(fs.readFileSync(bundle)),
    frozen: {
      reviewedSha: frozen,
      receiptSha256: JSON.parse(
        fs.readFileSync(
          path.join(
            repo,
            ".git",
            "funsidething-release-evidence",
            frozen,
            "receipt.json",
          ),
        ),
      ).receiptSha256,
      renderedEvidencePath: rendered,
      renderedEvidenceSha256: hash(fs.readFileSync(rendered)),
    },
    independentReview: review("fixture-code-review"),
    specialistReview: review("fixture-risk-review"),
    outgoing: {
      localRef: "refs/heads/diagnose/fixture",
      remoteRef: "refs/heads/diagnose/fixture",
      remoteBefore: "0".repeat(40),
    },
  };
  const inputPath = path.join(root, "input.json");
  fs.writeFileSync(inputPath, JSON.stringify(input));
  return addGovernanceFixture({
    root,
    repo,
    env,
    source,
    tree,
    input,
    inputPath,
    bundle,
    attempt,
    cp,
    remoteFile,
  });
}
test("diagnostic public plan admits only the exact approved executable dependency closure", t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'diagnostic-closure-')),repo=path.join(root,'repo');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  git(repository,'clone','-q','--shared','--no-checkout',repository,repo);git(repo,'checkout','-q',observer);
  git(repo,'config','user.name','Closure Fixture');git(repo,'config','user.email','closure@example.invalid');
  const dependencies=['scripts/agent-tools/workflow-validator.mjs','scripts/agent-tools/preflight.mjs','scripts/agent-tools/qualification-contracts.mjs','scripts/test-groups.mjs','scripts/agent-tools/ci-pass-reuse.mjs'];
  const governance=['scripts/release-evidence.mjs','scripts/agent-tools/diagnostic-receipt.mjs','scripts/agent-tools/diagnostic-hosted-policy.mjs','scripts/agent-tools/native-attribution.mjs','scripts/agent-tools/native-toolchain.json','scripts/agent-tools/native-known-control.json','scripts/agent-tools/build-native-known-control.py','scripts/agent-tools/checkpoint-progress.mjs','scripts/agent-tools/checkpoint.mjs','scripts/agent-tools/record-run.mjs','.github/workflows/data-safety.yml','.github/workflows/diagnostic.yml',...dependencies];
  for(const file of governance){fs.mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});fs.copyFileSync(path.join(repository,file),path.join(repo,file));}
  fs.writeFileSync(path.join(repo,'scripts/button-safety-mobile-memory.mjs'),diagnosticMobileSource(repo));
  git(repo,'add','.');git(repo,'commit','-qm','Exact approved current diagnostic command bundle');
  const source=git(repo,'rev-parse','HEAD');
  const plan=()=>command({repo,env:{}},'diagnostic-plan',git(repo,'rev-parse','HEAD'),frozen);
  const accepted=plan();assert.equal(accepted.status,0,'Approved exact executable closure must be eligible: '+accepted.stderr);
  const impact=JSON.parse(accepted.stdout);assert.equal(impact.kind,'nonqualifying-diagnostic-plan');assert.equal(impact.eligible,true);assert.equal(impact.governanceReady,true);assert.match(impact.toolingSha256,/^[a-f0-9]{64}$/);
  const changed=git(repo,'diff','--name-only',observer,source).split('\n').filter(Boolean);
  assert.ok(changed.every(file=>governance.includes(file)||file==='scripts/button-safety-mobile-memory.mjs'),'All frozen non-governance bytes and modes remain unchanged');
  for(const file of [...dependencies,'scripts/unknown-command-dependency.mjs','index.html','scripts/mobile-source-profile.json','scripts/test-group-inventory.json','scripts/test-group-assignments.json']){
    const target=path.join(repo,file);fs.appendFileSync(target,'\n// unapproved closure bytes\n');git(repo,'add',file);git(repo,'commit','-qm','Rejected closure mutation');
    const refused=plan();assert.notEqual(refused.status,0,file+' byte mutation must be refused');assert.match(refused.stderr,/frozen inventory|unknown instrumentation/);git(repo,'reset','--hard',source);
  }
  for(const file of dependencies){
    git(repo,'update-index','--chmod=+x',file);git(repo,'commit','-qm','Rejected closure mode mutation');assert.notEqual(plan().status,0,file+' mode mutation must be refused');git(repo,'reset','--hard',source);
  }
});

test("public diagnostic receipt records frozen reviewed source with its admitted finite attempt", (t) => {
  const f = fixture(t),
    r = command(f, "diagnostic-record", f.inputPath);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    JSON.parse(r.stdout).recorded,
    true,
    "the existing evidence command must record this eligible nonqualifying diagnostic",
  );
});

test("public diagnostic receipt transports no private journal bodies or local result pointers", (t) => {
  const f = fixture(t),
    r = command(f, "diagnostic-record", f.inputPath);
  assert.equal(r.status, 0, r.stderr);
  const receipt = JSON.parse(fs.readFileSync(JSON.parse(r.stdout).receiptPath)),
    admission = Buffer.from(
      receipt.body.files["admission.json"],
      "base64",
    ).toString();
  assert.equal(
    admission.includes("Bound diagnostic parent authority"),
    false,
    "publication must carry authority fingerprints rather than the private issue snapshot",
  );
  assert.equal(
    admission.includes("resultPath"),
    false,
    "publication must omit private local result paths",
  );
});

test("a canonical atomic diagnostic permit dispatches once and a fresh duplicate only observes", (t) => {
  const f = fixture(t);
  const recorded = command(f, "diagnostic-record", f.inputPath);
  assert.equal(recorded.status, 0, recorded.stderr);
  const first = command(f, "diagnostic-launch", f.source);
  assert.equal(first.status, 0, first.stderr);
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.equal(
    remote.dispatches.length,
    1,
    "the public launch must dispatch the admitted attempt exactly once",
  );
  const writes = remote.publications;
  const again = command(f, "diagnostic-launch", f.source);
  assert.equal(again.status, 0, again.stderr);
  const next = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.equal(next.dispatches.length, 1);
  assert.equal(
    next.publications,
    writes,
    "duplicate observation writes no blobs, trees, commits or refs",
  );
});

test("independent CI claims the canonical permit once for exact run attempt one", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launched = command(f, "diagnostic-launch", f.source);
  assert.equal(launched.status, 0, launched.stderr);
  const permit = JSON.parse(launched.stdout);
  seedRun(f, "1001");
  const claim = command(
    f,
    "diagnostic-ci-claim",
    permit.permit,
    permit.permitObject,
    f.source,
    "1001",
    "1",
  );
  assert.equal(claim.status, 0, claim.stderr);
  assert.equal(
    JSON.parse(claim.stdout).claimed,
    true,
    "the exact independent CI process must atomically claim its one admitted runtime",
  );
  const before = JSON.parse(fs.readFileSync(f.remoteFile)).publications;
  const duplicate = command(
    f,
    "diagnostic-ci-claim",
    permit.permit,
    permit.permitObject,
    f.source,
    "1001",
    "1",
  );
  assert.equal(duplicate.status, 0, duplicate.stderr);
  assert.equal(JSON.parse(duplicate.stdout).observed, true);
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, before);
  const wrong = command(
    f,
    "diagnostic-ci-claim",
    permit.permit,
    permit.permitObject,
    f.source,
    "1002",
    "1",
  );
  assert.notEqual(wrong.status, 0);
  const retry = command(
    f,
    "diagnostic-ci-claim",
    permit.permit,
    permit.permitObject,
    f.source,
    "1001",
    "2",
  );
  assert.notEqual(retry.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, before);
});

test("the real isolated diagnostic consumer starts only for the winning CI claim and retains a missing attribution failure", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout),
    output = path.join(f.root, "ci-output");
  seedRun(f, "2001");
  const run = command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "2001",
    "1",
    output,
  );
  assert.equal(
    fs.existsSync(path.join(output, "terminal.json")),
    true,
    "the supported command must retain the actual consumer terminal result",
  );
  const terminal = JSON.parse(
    fs.readFileSync(path.join(output, "terminal.json")),
  );
  assert.equal(
    terminal.requiredGateStatus,
    "failed",
    "missing native attribution cannot pay the required gate",
  );
  assert.equal(
    terminal.execution.started,
    false,
    "missing reviewed tooling request starts no runtime child",
  );
  assert.notEqual(run.status, 0);
  const bytes = fs.readFileSync(path.join(output, "terminal.json"));
  const again = command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "2001",
    "1",
    output,
  );
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(
    fs.readFileSync(path.join(output, "terminal.json")),
    bytes,
    "an observed duplicate starts no child and preserves the first result",
  );
});

function terminalFixture(f) {
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout),
    output = path.join(f.root, "ci-output");
  seedRun(f, "3001");
  const run = command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "3001",
    "1",
    output,
  );
  assert.equal(run.status, 1, run.stderr);
  const terminal = JSON.parse(
      fs.readFileSync(path.join(output, "terminal.json")),
    ),
    archive = path.join(f.root, "artifact.zip");
  const zipped = spawnSync("zip", ["-q", "-r", archive, "."], {
    cwd: output,
    encoding: "utf8",
  });
  assert.equal(zipped.status, 0, zipped.stderr);
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  remote.run = {
    id: 3001,
    head_sha: f.governance ?? f.source,
    head_branch: f.governance ? "main" : "diagnose/fixture",
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
    event: "workflow_dispatch",
    name: "Nonqualifying source-bound diagnostic",
    path: ".github/workflows/diagnostic.yml",
  };
  remote.jobs = [
    {
      name: "Nonqualifying diagnostic attempt",
      status: "completed",
      conclusion: "failure",
      steps: [
        {
          name: "Independently verify and atomically claim this attempt",
          conclusion: "failure",
        },
        {
          name: "Retain diagnostic evidence without product qualification",
          conclusion: "success",
        },
      ],
    },
  ];
  remote.logs = run.stdout + run.stderr;
  remote.artifacts = [
    {
      id: 501,
      name: "nonqualifying-diagnostic-3001-1",
      expired: false,
      digest: "sha256:" + hash(fs.readFileSync(archive)),
      workflow_run: { head_sha: f.governance },
    },
  ];
  remote.artifactZip = fs.readFileSync(archive).toString("base64");
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  const monitorDir = path.join(f.root, "monitor");
  const monitored = spawnSync(
    process.execPath,
    [
      path.join(repository, "scripts/agent-tools/ci-monitor.mjs"),
      "--repo",
      "emerald-pham/funsidething",
      "--run-id",
      "3001",
      "--commit",
      f.governance,
      "--evidence-dir",
      monitorDir,
      "--max-polls",
      "1",
      "--max-wait-ms",
      "2000",
      "--request-timeout-ms",
      "1000",
    ],
    { env: { ...process.env, ...f.env }, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(monitored.status, 2, monitored.stdout + monitored.stderr);
  const summary = path.join(
      monitorDir,
      fs.readdirSync(monitorDir)[0],
      "summary.json",
    ),
    input = path.join(f.root, "consume.json");
  fs.writeFileSync(
    input,
    JSON.stringify({
      monitorSummaryPath: summary,
      monitorSummarySha256: hash(fs.readFileSync(summary)),
    }),
  );
  return { ...f, launch, terminal, summary, consumeInput: input };
}
test("terminal consumption uses same-run monitor logs and remote artifact digest while retaining the failed required gate", (t) => {
  const f = terminalFixture(fixture(t)),
    result = command(f, "diagnostic-consume", f.source, f.consumeInput);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).consumed,
    true,
    "the actual terminal run evidence must be consumed against its admitted source",
  );
  const inspect = f.cp("inspect");
  assert.equal(inspect.status, 0, inspect.stderr);
  const state = JSON.parse(inspect.stdout);
  assert.equal(state.attempts[0].consumed, true);
  assert.equal(
    state.status,
    "open",
    "missing native attribution remains an unpaid required gate",
  );
  assert.equal(state.remaining, 1);
});

test("CI claim rejects a different actual GitHub source before any publication or runtime", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "4001");
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  remote.run.head_sha = frozen;
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  const before = remote.publications,
    output = path.join(f.root, "denied-ci"),
    result = command(
      f,
      "diagnostic-ci-run",
      launch.permit,
      launch.permitObject,
      f.source,
      "4001",
      "1",
      output,
    );
  assert.notEqual(
    result.status,
    0,
    "a caller supplied run tuple cannot substitute for actual GitHub run identity",
  );
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, before);
  assert.equal(fs.existsSync(output), false);
});

function resignFixtureReceipt(f, mutate) {
  const target = path.join(
      f.repo,
      ".git",
      "funsidething-diagnostic-evidence",
      f.source,
      "receipt.json",
    ),
    receipt = JSON.parse(fs.readFileSync(target));
  mutate(receipt.body);
  const sorted = (v) =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted(v[k])]),
          )
        : v;
  receipt.signature = sign(
    null,
    Buffer.from(JSON.stringify(sorted(receipt.body))),
    fs.readFileSync(
      path.join(f.repo, ".git", "diagnostic-progress", "signing-key.pem"),
    ),
  ).toString("base64");
  fs.writeFileSync(target, JSON.stringify(receipt));
}
test("portable verifier revalidates inherited full review bytes rather than trusting the local signing owner", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  resignFixtureReceipt(f, (body) => {
    for (const name of Object.keys(body.files))
      if (name.startsWith("frozen/")) {
        delete body.files[name];
        delete body.fileSha256[name];
      }
  });
  const result = command(f, "diagnostic-verify", f.source);
  assert.notEqual(
    result.status,
    0,
    "a signed permit with no inherited full product and FAQ review evidence cannot verify",
  );
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, 0);
});

test("actual pre-push permits only the admitted exact diagnostic destination and rejects promotion", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const push = (ref, sha = "0".repeat(40)) =>
    spawnSync(process.execPath, [f.cli ?? cli, "pre-push"], {
      cwd: f.repo,
      env: { ...process.env, ...f.env },
      input: `refs/heads/diagnose/fixture ${f.source} ${ref} ${sha}\n`,
      encoding: "utf8",
      timeout: 30000,
    });
  const allowed = push("refs/heads/diagnose/fixture");
  assert.equal(
    allowed.status,
    0,
    "supported exact diagnostic pre-push must use its nonqualifying receipt: " +
      allowed.stderr,
  );
  for (const ref of [
    "refs/heads/main",
    "refs/heads/diagnose/renamed",
    "refs/tags/v1",
  ])
    assert.notEqual(
      push(ref).status,
      0,
      "diagnostic receipt cannot authorize " + ref,
    );
  assert.notEqual(
    push("refs/heads/diagnose/fixture", "1".repeat(40)).status,
    0,
  );
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.equal(remote.publications, 0);
  assert.equal(remote.dispatches.length, 0);
});

test("portable authorization rejects observer-only HEAD drift even when selected inputs are unchanged", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  git(f.repo, "commit", "--allow-empty", "-qm", "Unadmitted observer context");
  const result = command(f, "diagnostic-verify", f.source);
  assert.notEqual(
    result.status,
    0,
    "portable verifier must bind the actual checkout commit and tree",
  );
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, 0);
});

test("diagnostic eligibility and receipt rejection matrix performs zero publication and launch side effects", (t) => {
  const f = fixture(t),
    assertQuiet = () => {
      const remote = JSON.parse(fs.readFileSync(f.remoteFile));
      assert.equal(remote.publications, 0);
      assert.equal(remote.dispatches.length, 0);
    };
  const rejectInput = (change) => {
    const input = structuredClone(f.input);
    change(input);
    const file = path.join(f.root, "rejected-input.json");
    fs.writeFileSync(file, JSON.stringify(input));
    const result = command(f, "diagnostic-record", file);
    assert.notEqual(result.status, 0, result.stdout);
    assertQuiet();
  };
  rejectInput((input) => {
    delete input.admissionPath;
  });
  rejectInput((input) => {
    input.specialistReview.domains.push("unknown-risk");
  });
  rejectInput((input) => {
    input.frozen.receiptSha256 = "a".repeat(64);
  });
  const prior = fs.readFileSync(f.input.specialistReview.evidencePath);
  fs.appendFileSync(
    f.input.specialistReview.evidencePath,
    "stale review bytes",
  );
  rejectInput(() => {});
  fs.writeFileSync(f.input.specialistReview.evidencePath, prior);
  for (const file of [
    "index.html",
    "package-lock.json",
    "scripts/button-safety-ci-policy.mjs",
    "scripts/button-safety-mobile-memory.mjs",
    "scripts/mobile-frame-observer.mjs",
  ]) {
    const target = path.join(f.repo, file),
      original = fs.readFileSync(target);
    fs.appendFileSync(target, "\n// unreviewed invariant or observer change\n");
    git(f.repo, "add", file);
    git(f.repo, "commit", "-qm", "Rejected diagnostic mutation");
    const result = command(
      f,
      "diagnostic-plan",
      git(f.repo, "rev-parse", "HEAD"),
      frozen,
    );
    assert.notEqual(
      result.status,
      0,
      file + " must not enter known template envelope",
    );
    assertQuiet();
    git(f.repo, "reset", "--hard", f.source);
    assert.deepEqual(fs.readFileSync(target), original);
  }
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const receipt = path.join(
      f.repo,
      ".git",
      "funsidething-diagnostic-evidence",
      f.source,
      "receipt.json",
    ),
    bytes = fs.readFileSync(receipt, "utf8");
  fs.writeFileSync(receipt, bytes.replace("fixture-owner", "tampered-owner"));
  assert.notEqual(command(f, "diagnostic-launch", f.source).status, 0);
  assertQuiet();
});
function asyncCommand(f, op, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [f.cli ?? cli, op, ...args], {
      cwd: f.repo,
      env: { ...process.env, ...f.env },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
test("concurrent fresh launch processes publish one canonical permit and dispatch once", async (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const results = await Promise.all([
    asyncCommand(f, "diagnostic-launch", f.source),
    asyncCommand(f, "diagnostic-launch", f.source),
  ]);
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.equal(remote.dispatches.length, 1);
  assert.equal(Object.keys(remote.refs).length, 2);
  assert.equal(
    results.map((r) => JSON.parse(r.stdout)).filter((r) => !r.observed).length,
    1,
  );
  const writes = remote.publications;
  assert.equal(command(f, "diagnostic-launch", f.source).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, writes);
});
test("an interrupted canonical reservation stays unresolved without objects dispatch or renewed allowance", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  remote.refs["refs/tags/chain-diagnostics/task-286/attempt-1/reservation"] =
    f.source;
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  const result = command(f, "diagnostic-launch", f.source);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).outcome, "reserved-unresolved");
  const next = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.equal(next.publications, 0);
  assert.equal(next.dispatches.length, 0);
  assert.equal(JSON.parse(f.cp("inspect").stdout).remaining, 1);
});
test("fresh checkout verifies portable frozen reviews and admitted attempt without local private journal or repeated review", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const fresh = path.join(f.root, "fresh");
  git(f.repo, "clone", "-q", "--shared", f.repo, fresh);
  git(fresh, "checkout", "-q", f.source);
  git(
    fresh,
    "remote",
    "set-url",
    "origin",
    "https://github.com/emerald-pham/funsidething.git",
  );
  const folder = path.join(
    fresh,
    ".git",
    "funsidething-diagnostic-evidence",
    f.source,
  );
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(
    path.join(
      f.repo,
      ".git",
      "funsidething-diagnostic-evidence",
      f.source,
      "receipt.json",
    ),
    path.join(folder, "receipt.json"),
  );
  const result = command({ ...f, repo: fresh }, "diagnostic-verify", f.source);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).verified, true);
  assert.equal(
    fs.existsSync(
      path.join(fresh, ".git", "diagnostic-progress", "signing-key.pem"),
    ),
    false,
  );
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, 0);
});
test("terminal tamper missing logs and wrong run identity cannot consume or renew an admitted attempt", (t) => {
  const f = terminalFixture(fixture(t)),
    remote = JSON.parse(fs.readFileSync(f.remoteFile)),
    before = remote.publications;
  const check = () => {
    const result = command(f, "diagnostic-consume", f.source, f.consumeInput);
    assert.notEqual(result.status, 0);
    assert.equal(
      JSON.parse(f.cp("inspect").stdout).attempts[0].consumed,
      false,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(f.remoteFile)).publications,
      before,
    );
  };
  remote.artifactZip = Buffer.from("tampered remote archive").toString(
    "base64",
  );
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  check();
  remote.artifactZip = fs
    .readFileSync(path.join(f.root, "artifact.zip"))
    .toString("base64");
  remote.run.run_attempt = 2;
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  check();
  remote.run.run_attempt = 1;
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  const summary = JSON.parse(fs.readFileSync(f.summary));
  fs.writeFileSync(summary.logs, "logs with no exact source claim header");
  check();
});

test("actual product verify publication and deployment gates reject diagnostic identity before outgoing statuses", async (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  for (const operation of ["verify", "publish"]) {
    const result = command(f, operation, f.source);
    assert.notEqual(
      result.status,
      0,
      operation + " cannot borrow diagnostic review",
    );
    assert.match(result.stderr, /Diagnostic|diagnostic/);
  }
  const { verifyDeploymentEvidence } = await import("../release-evidence.mjs");
  let statusReads = 0;
  const result = await verifyDeploymentEvidence({
    repoRoot: f.repo,
    repository: "emerald-pham/funsidething",
    deployedSha: f.source,
    beforeSha: observer,
    token: "fixture",
    fetchImpl: async (url) => {
      const suffix = url.replace(
        "https://api.github.com/repos/emerald-pham/funsidething",
        "",
      );
      let value;
      if (suffix === "/commits/" + f.source)
        value = {
          parents: [{ sha: observer }],
          commit: { tree: { sha: f.tree } },
        };
      else if (suffix === "/commits/" + f.source + "/pulls?per_page=100")
        value = [
          {
            number: 1,
            merge_commit_sha: f.source,
            merged_at: "2026-10-27T00:00:00Z",
            base: { ref: "main" },
            head: { sha: f.source },
          },
        ];
      else {
        statusReads++;
        throw Error("unexpected product promotion read " + suffix);
      }
      return { ok: true, json: async () => value };
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /Diagnostic|diagnostic/);
  assert.equal(statusReads, 0);
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.equal(remote.publications, 0);
  assert.equal(remote.dispatches.length, 0);
});

test("a signed portable admission without a finite budget is denied before publication", (t) => {
  const f = fixture(t),
    bundle = JSON.parse(fs.readFileSync(f.bundle));
  delete bundle.body.state.allowance;
  bundle.signature = sign(
    null,
    Buffer.from(JSON.stringify(bundle.body)),
    fs.readFileSync(
      path.join(f.repo, ".git", "diagnostic-progress", "signing-key.pem"),
    ),
  ).toString("base64");
  fs.writeFileSync(f.bundle, JSON.stringify(bundle));
  f.input.admissionSha256 = hash(fs.readFileSync(f.bundle));
  fs.writeFileSync(f.inputPath, JSON.stringify(f.input));
  const result = command(f, "diagnostic-record", f.inputPath);
  assert.notEqual(
    result.status,
    0,
    "a signature cannot substitute for an explicit positive finite allowance",
  );
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, 0);
});

test("a symlinked runtime output into the checkout is denied before claim publication", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "7001");
  const hidden = path.join(f.repo, ".git", "unsafe-runtime");
  fs.mkdirSync(hidden);
  const output = path.join(f.root, "output-link");
  fs.symlinkSync(hidden, output);
  const before = JSON.parse(fs.readFileSync(f.remoteFile)).publications;
  command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "7001",
    "1",
    output,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(f.remoteFile)).publications,
    before,
    "invalid evidence destination must fail before creating canonical claim objects",
  );
  assert.deepEqual(fs.readdirSync(hidden), []);
});

test("the winning diagnostic runtime installs pinned dependencies once before the actual consumer", (t) => {
  const f = fixture(t),
    count = path.join(f.root, "dependency-installs.txt"),
    npm = path.join(f.root, "bin", "npm");
  fs.writeFileSync(
    npm,
    `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(count)},JSON.stringify(process.argv.slice(2))+'\\n');`,
  );
  fs.chmodSync(npm, 0o700);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "8001");
  const output = path.join(f.root, "dependency-runtime");
  command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "8001",
    "1",
    output,
  );
  assert.equal(
    fs.existsSync(count),
    true,
    "the actual supported entrypoint must prepare the frozen lockfile dependencies",
  );
  assert.equal(fs.readFileSync(count, "utf8"), '["ci","--ignore-scripts"]\n');
  command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "8001",
    "1",
    output,
  );
  assert.equal(
    fs.readFileSync(count, "utf8"),
    '["ci","--ignore-scripts"]\n',
    "a duplicate claim must start no installer or consumer",
  );
});

test("ordinary governance source with a standalone diagnostic workflow retains full product receipt and publication authority", async (t) => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "ordinary-diagnostic-governance-"),
    ),
    repo = path.join(root, "repo");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(repository, "clone", "-q", "--shared", repository, repo);
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.test");
  git(
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/emerald-pham/funsidething.git",
  );
  // Use the exact ordinary marker-rejection command shape without depending on
  // an unlanded owner's commit being available in a fresh CI clone.
  const workflow = fs
    .readFileSync(path.join(repo, ".github/workflows/data-safety.yml"), "utf8")
    .replace(
      "      - uses: actions/setup-node@v4",
      `      - name: Reject nonqualifying diagnostic source
        shell: bash
        run: |
          if git cat-file -e HEAD:.diagnostic-task.json 2>/dev/null; then
            echo "nonqualifying diagnostic source: ordinary product qualification is unavailable; use supported diagnostic workflow" >&2
            exit 1
          fi
      - uses: actions/setup-node@v4`,
    );
  fs.writeFileSync(
    path.join(repo, ".github/workflows/data-safety.yml"),
    workflow,
  );
  git(repo, "add", ".");
  git(
    repo,
    "commit",
    "-qm",
    "Ordinary governance rejects marked diagnostic sources",
  );
  const source = git(repo, "rev-parse", "HEAD"),
    base = "e282f51dbea5fe07aac7673c92f6171f8f59d175",
    plan = deriveReleaseReviewPlan(repo, source, base),
    report = path.join(root, "synthetic-review.txt");
  fs.writeFileSync(
    report,
    "Synthetic ordinary enforcement review fixture, not an actual release approval.",
  );
  const now = new Date().toISOString(),
    review = (task) => ({
      task,
      reviewedSha: source,
      outcome: "approved",
      completedAt: now,
      summary:
        "Synthetic independent full enforcement review for ordinary governance compatibility.",
      scope: {
        fullDiff: true,
        relevantTests: true,
        userVisibleAndDataSafety: true,
      },
      evidencePath: report,
      evidenceSha256: hash(fs.readFileSync(report)),
    });
  const input = {
    schemaVersion: 2,
    candidate: {
      commitSha: source,
      treeSha: git(repo, "rev-parse", "HEAD^{tree}"),
      baseSha: base,
    },
    ownerReview: {
      ...review("ordinary-owner"),
      scope: {
        fullDiff: true,
        rationale:
          "Synthetic fixture reviews every ordinary governance source change.",
      },
    },
    independentReview: review("ordinary-code"),
    faqReview: review("ordinary-faq"),
    specialistReview: {
      ...review("ordinary-risk"),
      domains: plan.specialistDomains,
      memoryScope: Object.fromEntries(
        ["memory", "cloud", "sync"].map((domain) => [
          domain,
          {
            affected: false,
            rationale:
              "Synthetic governance fixture preserves frozen product behavior and persisted state.",
            tests:
              domain === "memory" ? ["ordinary full receipt preservation"] : [],
          },
        ]),
      ),
      sources: [{ path: report, sha256: hash(fs.readFileSync(report)) }],
    },
  };
  const inputPath = path.join(root, "input.json");
  fs.writeFileSync(inputPath, JSON.stringify(input));
  const recorded = command({ repo, env: {} }, "record", inputPath);
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(command({ repo, env: {} }, "verify", source).status, 0);
  const { publishReleaseStatuses } = await import("../release-evidence.mjs"),
    statuses = [];
  await publishReleaseStatuses(repo, source, async (status) =>
    statuses.push(status),
  );
  assert.ok(
    statuses.length >= 3,
    "ordinary full source retains all required publication statuses",
  );
  assert.ok(
    statuses.every(
      (status) => status.state === "success" || status.description,
    ),
  );
});

test("only named inherited review artifacts are selected and unrelated private files never enter a public permit", (t) => {
  const f = fixture(t),
    secret = path.join(
      f.repo,
      ".git",
      "funsidething-release-evidence",
      frozen,
      "signing-key.pem",
    );
  fs.writeFileSync(
    secret,
    "-----BEGIN PRIVATE KEY-----\nSYNTHETIC PRIVATE CANARY\n",
  );
  const result = command(f, "diagnostic-record", f.inputPath);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(
    fs.readFileSync(JSON.parse(result.stdout).receiptPath),
  );
  assert.equal(
    Object.keys(receipt.body.files).some((name) =>
      name.endsWith("signing-key.pem"),
    ),
    false,
    "publication must select review artifacts rather than copying an evidence directory",
  );
  assert.equal(
    JSON.stringify(receipt).includes(
      Buffer.from(
        "-----BEGIN PRIVATE KEY-----\nSYNTHETIC PRIVATE CANARY\n",
      ).toString("base64"),
    ),
    false,
  );
});

test("independent CI restores nested immutable proof artifacts through actual recursive Git tree semantics", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9001");
  const claim = command(
    f,
    "diagnostic-ci-claim",
    launch.permit,
    launch.permitObject,
    f.source,
    "9001",
    "1",
  );
  assert.equal(
    claim.status,
    0,
    "GitHub nested review tree must restore before claim: " + claim.stderr,
  );
  assert.equal(JSON.parse(claim.stdout).claimed, true);
  const requests = JSON.parse(fs.readFileSync(f.remoteFile)).requests;
  assert.ok(
    requests.some((args) =>
      args.some(
        (value) =>
          value.includes("/git/trees/") && value.includes("?recursive=1"),
      ),
    ),
    "the independent verifier must request complete recursive tree entries",
  );
});

function addGovernanceFixture(f) {
  const gov = path.join(f.root, "governance");
  git(repository, "clone", "-q", "--shared", repository, gov);
  git(gov, "config", "user.name", "Fixture");
  git(gov, "config", "user.email", "fixture@example.test");
  git(
    gov,
    "remote",
    "set-url",
    "origin",
    "https://github.com/emerald-pham/funsidething.git",
  );
  const base = git(gov, "rev-parse", "HEAD");
  for (const file of [
    "scripts/release-evidence.mjs",
    "scripts/agent-tools/diagnostic-receipt.mjs",
    "scripts/agent-tools/diagnostic-hosted-policy.mjs",
    "scripts/agent-tools/native-attribution.mjs",
    "scripts/agent-tools/native-toolchain.json",
    "scripts/agent-tools/native-known-control.json",
    "scripts/agent-tools/build-native-known-control.py",
    "scripts/agent-tools/checkpoint-progress.mjs",
    "scripts/agent-tools/checkpoint.mjs",
    "scripts/agent-tools/record-run.mjs",
    "scripts/agent-tools/workflow-validator.mjs",
    "scripts/agent-tools/preflight.mjs",
    "scripts/agent-tools/qualification-contracts.mjs",
    "scripts/test-groups.mjs",
    "scripts/agent-tools/ci-pass-reuse.mjs",
    ".github/workflows/data-safety.yml",
    ".github/workflows/diagnostic.yml",
  ])
    fs.copyFileSync(path.join(repository, file), path.join(gov, file));
  fs.writeFileSync(
    path.join(gov, "scripts/agent-tools/governance-fixture.mjs"),
    "export const syntheticGovernanceFixture = true;\n",
  );
  git(gov, "add", ".");
  git(
    gov,
    "commit",
    "--allow-empty",
    "-qm",
    "Normally reviewed governance fixture",
  );
  const reviewed = git(gov, "rev-parse", "HEAD"),
    tree = git(gov, "rev-parse", "HEAD^{tree}"),
    main = git(
      gov,
      "commit-tree",
      tree,
      "-p",
      base,
      "-p",
      reviewed,
      "-m",
      "Normal merged governance fixture",
    );
  git(gov, "checkout", "-q", main);
  const report = path.join(f.root, "governance-review.txt");
  fs.writeFileSync(
    report,
    "Synthetic governance full review; no actual production approval.",
  );
  const now = new Date().toISOString(),
    review = (task) => ({
      task,
      reviewedSha: reviewed,
      outcome: "approved",
      completedAt: now,
      summary:
        "Synthetic exact full governance review and publication control.",
      scope: {
        fullDiff: true,
        relevantTests: true,
        userVisibleAndDataSafety: true,
      },
      evidencePath: report,
      evidenceSha256: hash(fs.readFileSync(report)),
    }),
    plan = deriveReleaseReviewPlan(gov, reviewed, base);
  recordReleaseEvidence(gov, {
    schemaVersion: 2,
    candidate: { commitSha: reviewed, treeSha: tree, baseSha: base },
    ownerReview: {
      ...review("gov-owner"),
      scope: {
        fullDiff: true,
        rationale: "Synthetic fixture reviews every governance source change.",
      },
    },
    independentReview: review("gov-code"),
    faqReview: review("gov-faq"),
    specialistReview: plan.requiresSpecialistReview
      ? {
          ...review("gov-risk"),
          domains: plan.specialistDomains,
          memoryScope: Object.fromEntries(
            ["memory", "cloud", "sync"].map((domain) => [
              domain,
              {
                affected: false,
                rationale:
                  "Governance fixture preserves unchanged product and saved state.",
                tests: domain === "memory" ? ["source preservation"] : [],
              },
            ]),
          ),
          sources: [{ path: report, sha256: hash(fs.readFileSync(report)) }],
        }
      : undefined,
  });
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  remote.http = {
    "/": { default_branch: "main" },
    "/branches/main": { name: "main", protected: true, commit: { sha: main } },
    ["/commits/" + main]: {
      sha: main,
      parents: [{ sha: base }, { sha: reviewed }],
      commit: { tree: { sha: tree } },
    },
    ["/commits/" + main + "/pulls?per_page=100"]: [
      {
        number: 22,
        merge_commit_sha: main,
        merged_at: now,
        base: { ref: "main" },
        head: { sha: reviewed },
      },
    ],
    ["/commits/" + reviewed]: {
      sha: reviewed,
      commit: { tree: { sha: tree } },
    },
    ["/compare/" + base + "..." + reviewed]: { status: "ahead" },
  };
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  const govCLI = fs.realpathSync(
      path.join(gov, "scripts/release-evidence.mjs"),
    ),
    published = spawnSync(process.execPath, [govCLI, "publish", reviewed], {
      cwd: gov,
      env: { ...process.env, ...f.env },
      encoding: "utf8",
    });
  assert.equal(published.status, 0, published.stderr);
  const withStatuses = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.ok(
    withStatuses.normalStatuses,
    JSON.stringify({
      published: published.stdout,
      requests: withStatuses.requests,
    }),
  );
  withStatuses.http["/commits/" + reviewed + "/statuses?per_page=100"] =
    withStatuses.normalStatuses[reviewed];
  withStatuses.publications = 0;
  withStatuses.requests = [];
  fs.writeFileSync(f.remoteFile, JSON.stringify(withStatuses));
  f.input.governance = { commitSha: main };
  fs.writeFileSync(f.inputPath, JSON.stringify(f.input));
  return {
    ...f,
    cli: govCLI,
    governanceRepo: gov,
    governance: main,
    governanceTree: tree,
  };
}
test("a nonqualifying receipt binds independently reviewed protected governance separately from diagnostic source", (t) => {
  const f = fixture(t),
    result = command(f, "diagnostic-record", f.inputPath);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(
    fs.readFileSync(JSON.parse(result.stdout).receiptPath),
  );
  assert.equal(
    receipt.body.governance?.commitSha,
    f.governance,
    "the signed receipt must bind the actual protected default governance head",
  );
  assert.notEqual(f.governance, f.source);
  assert.equal(receipt.body.governance.defaultRef, "refs/heads/main");
  assert.equal(receipt.body.governance.treeSha, f.governanceTree);
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, 0);
});

test("diagnostic dispatch selects the protected governance default ref and rejects a moved head before any write", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launched = command(f, "diagnostic-launch", f.source);
  assert.equal(launched.status, 0, launched.stderr);
  const remote = JSON.parse(fs.readFileSync(f.remoteFile)),
    args = remote.dispatches[0];
  assert.equal(
    args[args.indexOf("--ref") + 1],
    "main",
    "workflow dispatch must execute approved default governance rather than candidate-selected code",
  );
});
test("a changed protected default head cannot publish any diagnostic reservation objects or dispatch", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  remote.http["/branches/main"].commit.sha = "1".repeat(40);
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  const result = command(f, "diagnostic-launch", f.source);
  assert.notEqual(
    result.status,
    0,
    "moved default head must stop before publication",
  );
  const actual = JSON.parse(fs.readFileSync(f.remoteFile));
  assert.equal(actual.publications, 0);
  assert.equal(actual.dispatches.length, 0);
  assert.equal(
    JSON.parse(f.cp("inspect").stdout).remaining,
    1,
    "the reserved diagnostic allowance is neither reset nor renewed",
  );
});

test("independent CI claim binds actual main governance run while retaining distinct diagnostic source", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9101");
  const remote = JSON.parse(fs.readFileSync(f.remoteFile));
  remote.run.head_sha = f.governance;
  remote.run.head_branch = "main";
  fs.writeFileSync(f.remoteFile, JSON.stringify(remote));
  f.env.GITHUB_SHA = f.governance;
  f.env.GITHUB_REF = "refs/heads/main";
  f.env.GITHUB_EVENT_NAME = "workflow_dispatch";
  const result = command(
    f,
    "diagnostic-ci-claim",
    launch.permit,
    launch.permitObject,
    f.source,
    "9101",
    "1",
  );
  assert.equal(
    result.status,
    0,
    "actual governance run must authorize separately bound source: " +
      result.stderr,
  );
  const claim = JSON.parse(result.stdout);
  assert.equal(claim.claimed, true);
  assert.equal(claim.source, f.source);
  assert.equal(claim.governance, f.governance);
});
test("a source-headed diagnostic workflow cannot impersonate protected main governance or write a claim", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9102");
  const oldRun = JSON.parse(fs.readFileSync(f.remoteFile));
  oldRun.run.head_sha = f.source;
  oldRun.run.head_branch = "diagnose/fixture";
  fs.writeFileSync(f.remoteFile, JSON.stringify(oldRun));
  const before = JSON.parse(fs.readFileSync(f.remoteFile)).publications;
  const result = command(
    f,
    "diagnostic-ci-claim",
    launch.permit,
    launch.permitObject,
    f.source,
    "9102",
    "1",
  );
  assert.notEqual(
    result.status,
    0,
    "source workflow head cannot stand in for governance",
  );
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, before);
});

test("actual diagnostic descendant retains truthful governance metadata and receives no publication credentials", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9201");
  f.env.GITHUB_SHA = f.governance;
  f.env.GITHUB_REF = "refs/heads/main";
  f.env.GITHUB_EVENT_NAME = "workflow_dispatch";
  f.env.GH_TOKEN = "synthetic-publication-canary";
  f.env.GITHUB_TOKEN = "synthetic-publication-canary";
  const output = path.join(f.root, "truthful-runtime");
  command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "9201",
    "1",
    output,
  );
  const terminal = JSON.parse(
    fs.readFileSync(path.join(output, "terminal.json")),
  );
  assert.equal(
    terminal.governance?.commitSha,
    f.governance,
    "terminal must retain the actual workflow governance head",
  );
  assert.equal(terminal.source, f.source);
  assert.equal(terminal.environment?.policy.eventRef, "refs/heads/main");
  assert.equal(
    terminal.environment?.policy.sourceRef,
    "refs/heads/diagnose/fixture",
  );
  assert.deepEqual(
    terminal.environment?.credentialKeys,
    [],
    "actual descendant process environment must omit publication credentials",
  );
  assert.equal(terminal.execution.phase, "native-tool-delivery");
  assert.equal(terminal.execution.started, false);
});
test("terminal consumption binds governance run and artifact head separately from admitted app source", (t) => {
  const f = terminalFixture(fixture(t)),
    result = command(f, "diagnostic-consume", f.source, f.consumeInput);
  assert.equal(
    result.status,
    0,
    "real governed run head and separate app source must consume without substitution: " +
      result.stderr,
  );
  assert.equal(JSON.parse(result.stdout).consumed, true);
  assert.equal(JSON.parse(f.cp("inspect").stdout).remaining, 1);
  assert.equal(JSON.parse(f.cp("inspect").stdout).status, "open");
});

test("environment-only diagnostic descendant forgery cannot launch through the public source host guard", (t) => {
  const f = fixture(t),
    claim = "a".repeat(40),
    env = {
      ...f.env,
      CI: "true",
      CHAIN_TEST_EVENT_POLICY: "diagnostic-workflow-dispatch-v1",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: f.governance,
      GITHUB_RUN_ID: "9301",
      GITHUB_RUN_ATTEMPT: "1",
      CHAIN_DIAGNOSTIC_GOVERNANCE: f.governance,
      CHAIN_DIAGNOSTIC_SOURCE: f.source,
      CHAIN_TEST_SOURCE_SHA: f.source,
      CHAIN_DIAGNOSTIC_SOURCE_REF: "refs/heads/diagnose/fixture",
      CHAIN_DIAGNOSTIC_CLAIM: claim,
      CHAIN_DIAGNOSTIC_AUTHORIZATION: [
        f.governance,
        f.source,
        "refs/heads/diagnose/fixture",
        "9301",
        "1",
        claim,
      ].join(":"),
    };
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {assertDiagnosticRuntimeAllowed} from './scripts/agent-tools/checkpoint-progress.mjs';assertDiagnosticRuntimeAllowed(process.cwd(),${JSON.stringify(f.source)},${JSON.stringify(f.input.admissionPath)});console.log('RUNTIME_ADMITTED');`,
    ],
    { cwd: f.repo, env: { ...process.env, ...env }, encoding: "utf8" },
  );
  assert.notEqual(
    result.status,
    0,
    "copied public metadata and signed admission cannot replace a fresh parent-issued one-use channel",
  );
  assert.doesNotMatch(result.stdout, /RUNTIME_ADMITTED/);
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, 0);
});

test("a verified child consumes its inherited authorization once and cannot replay it", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9401");
  const output = path.join(f.root, "replay-control");
  command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "9401",
    "1",
    output,
  );
  const terminal = JSON.parse(
    fs.readFileSync(path.join(output, "terminal.json")),
  );
  assert.equal(
    terminal.environment?.replayDenied,
    true,
    "the actual authorized child must reject a second consumption in the same process",
  );
});

test("actual inherited channels reject wrong stale and non-governance parent contexts before runtime", async (t) => {
  const f = fixture(t),
    { diagnosticChannelPayload } = await import("./checkpoint-progress.mjs"),
    claim = "b".repeat(40),
    context = {
      governance: f.governance,
      source: f.source,
      sourceRef: "refs/heads/diagnose/fixture",
      claim,
      runId: "9501",
      runAttempt: 1,
    },
    env = {
      ...process.env,
      ...f.env,
      CI: "true",
      CHAIN_TEST_EVENT_POLICY: "diagnostic-workflow-dispatch-v1",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: f.governance,
      GITHUB_RUN_ID: "9501",
      GITHUB_RUN_ATTEMPT: "1",
      CHAIN_DIAGNOSTIC_GOVERNANCE: f.governance,
      CHAIN_DIAGNOSTIC_SOURCE: f.source,
      CHAIN_TEST_SOURCE_SHA: f.source,
      CHAIN_DIAGNOSTIC_SOURCE_REF: context.sourceRef,
      CHAIN_DIAGNOSTIC_CLAIM: claim,
      CHAIN_DIAGNOSTIC_AUTHORIZATION: [
        f.governance,
        f.source,
        context.sourceRef,
        "9501",
        "1",
        claim,
      ].join(":"),
    };
  for (const [mode, expected] of [
    ["wrong", /context mismatch/],
    ["stale", /stale or malformed/],
    ["foreign", /not the bound immutable governance invocation/],
  ]) {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {assertDiagnosticRuntimeAllowed} from './scripts/agent-tools/checkpoint-progress.mjs';assertDiagnosticRuntimeAllowed(process.cwd(),${JSON.stringify(f.source)},${JSON.stringify(f.bundle)});console.log('RUNTIME_ADMITTED');`,
      ],
      { cwd: f.repo, env, stdio: ["ignore", "pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const exited = new Promise((resolve) => child.on("close", resolve));
    const payload = diagnosticChannelPayload(
      { ...context, governanceRoot: f.governanceRepo },
      child.pid,
    );
    if (mode === "wrong") payload.claim = "c".repeat(40);
    if (mode === "stale") {
      payload.issuedAt -= 10000;
      payload.expiresAt -= 10000;
    }
    child.stdio[3].on("error", () => {});
    child.stdio[3].end(JSON.stringify(payload));
    assert.notEqual(await exited, 0);
    assert.match(stderr, expected, stderr);
    assert.doesNotMatch(stdout, /RUNTIME_ADMITTED/);
  }
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, 0);
});
test("Node injection configuration cannot publish a claim or start a diagnostic descendant", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9502");
  const before = JSON.parse(fs.readFileSync(f.remoteFile)).publications;
  f.env.NODE_PATH = "/untrusted-diagnostic-injection";
  const output = path.join(f.root, "injection-control"),
    result = command(
      f,
      "diagnostic-ci-run",
      launch.permit,
      launch.permitObject,
      f.source,
      "9502",
      "1",
      output,
    );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /preload or module-path injection/);
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).publications, before);
  assert.equal(fs.existsSync(output), false);
  assert.equal(
    fs.existsSync(path.join(f.root, "dependency-installs.txt")),
    false,
  );
});

test("the literal workflow node invocation retains a valid kernel-bound parent channel", (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9601");
  const workflow = fs.readFileSync(
    path.join(repository, ".github/workflows/diagnostic.yml"),
    "utf8",
  );
  assert.match(
    workflow,
    /run: node "\$GITHUB_WORKSPACE\/governance\/scripts\/release-evidence\.mjs" diagnostic-ci-run --repo "\$GITHUB_WORKSPACE\/diagnostic-source"/,
  );
  assert.match(
    workflow,
    /"\$RUNNER_TEMP\/nonqualifying-diagnostic" prepare-reviewed-native-tools/,
  );
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  f.pathNode = true;
  const output = path.join(f.root, "path-node-control");
  command(
    f,
    "diagnostic-ci-run",
    launch.permit,
    launch.permitObject,
    f.source,
    "9601",
    "1",
    output,
  );
  const terminal = JSON.parse(
    fs.readFileSync(path.join(output, "terminal.json")),
  );
  assert.equal(
    terminal.environment?.replayDenied,
    true,
    "the real shell-selected node executable may have argv0=node while retaining the exact kernel executable: " +
      fs.readFileSync(path.join(output, "stderr.txt"), "utf8"),
  );
  assert.equal(terminal.execution.phase, "native-tool-delivery");
});

test("concurrent winning CI runners retain one actual authorized child identity and no duplicate runtime", async (t) => {
  const f = fixture(t);
  assert.equal(command(f, "diagnostic-record", f.inputPath).status, 0);
  const launch = JSON.parse(command(f, "diagnostic-launch", f.source).stdout);
  seedRun(f, "9701");
  const output = path.join(f.root, "concurrent-runtime"),
    children = [],
    results = [];
  for (let i = 0; i < 2; i++) {
    const child = spawn(
      process.execPath,
      [
        f.cli,
        "diagnostic-ci-run",
        "--repo",
        f.repo,
        launch.permit,
        launch.permitObject,
        f.source,
        "9701",
        "1",
        output,
      ],
      {
        cwd: f.repo,
        env: { ...process.env, ...f.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    children.push(child);
    results.push(
      new Promise((resolve) =>
        child.on("close", (code) => resolve({ code, stdout, stderr })),
      ),
    );
  }
  const parents = new Set(children.map((c) => c.pid)),
    observed = new Set();
  let finished = false;
  const all = Promise.all(results).then((r) => {
    finished = true;
    return r;
  });
  while (!finished) {
    const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,args="], {
      encoding: "utf8",
      timeout: 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(ps.status, 0);
    for (const line of ps.stdout.split("\n")) {
      const row = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (
        row &&
        parents.has(Number(row[2])) &&
        row[3].includes("let replayDenied=false")
      )
        observed.add(Number(row[1]));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const exits = await all;
  assert.equal(
    exits.filter((r) => r.code === 1).length,
    1,
    JSON.stringify(exits),
  );
  assert.equal(
    exits.filter((r) => r.code === 0).length,
    1,
    JSON.stringify(exits),
  );
  assert.equal(
    observed.size,
    1,
    "kernel-observed child process census sees one authorized source guard",
  );
  const terminal = JSON.parse(
    fs.readFileSync(path.join(output, "terminal.json")),
  );
  assert.equal(
    terminal.environment?.channel?.childPid,
    [...observed][0],
    "durable environment evidence binds the actual independently observed authorized child PID",
  );
  assert.equal(terminal.execution.started, false);
  assert.equal(JSON.parse(fs.readFileSync(f.remoteFile)).dispatches.length, 1);
  const refs = Object.keys(JSON.parse(fs.readFileSync(f.remoteFile)).refs);
  assert.equal(refs.filter((r) => r.endsWith("/claim")).length, 1);
  assert.equal(refs.filter((r) => r.endsWith("/claim-reservation")).length, 1);
});
