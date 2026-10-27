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
    head_sha: f.source,
    head_branch: "diagnose/fixture",
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
  return spawnSync(process.execPath, [cli, op, ...args], {
    cwd: f.repo,
    env: { ...process.env, ...f.env },
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
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
    "scripts/agent-tools/checkpoint-progress.mjs",
    "scripts/agent-tools/checkpoint.mjs",
    "scripts/agent-tools/record-run.mjs",
    ".github/workflows/data-safety.yml",
    ".github/workflows/diagnostic.yml",
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.copyFileSync(path.join(repository, file), path.join(repo, file));
  }
  const mobile = path.join(repo, "scripts/button-safety-mobile-memory.mjs");
  fs.writeFileSync(
    mobile,
    fs
      .readFileSync(mobile, "utf8")
      .replace(
        "import {hostedButtonPolicy} from './button-safety-ci-policy.mjs';",
        "import {hostedButtonPolicy} from './agent-tools/diagnostic-hosted-policy.mjs';",
      )
      .replace(
        "'CHAIN_TEST_SOURCE_SHA','CHAIN_DIAGNOSTIC_ACTIVATION'",
        "'CHAIN_TEST_SOURCE_SHA','CHAIN_DIAGNOSTIC_CLAIM','CHAIN_DIAGNOSTIC_SOURCE','CHAIN_DIAGNOSTIC_AUTHORIZATION','CHAIN_DIAGNOSTIC_ACTIVATION'",
      )
      .replace(
        "import assert from 'node:assert/strict';",
        "import assert from 'node:assert/strict';\nimport {assertDiagnosticRuntimeAllowed} from './agent-tools/checkpoint-progress.mjs';",
      )
      .replace(
        "export async function runCappedMobile({outputDir,budgetProfile='required-1gb'}){",
        "export async function runCappedMobile({outputDir,budgetProfile='required-1gb'}){\n assertDiagnosticRuntimeAllowed(root,git('rev-parse','HEAD'),process.env.CHAIN_DIAGNOSTIC_BUNDLE);",
      ),
  );
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
  const env = {
    PATH: bin + path.delimiter + process.env.PATH,
    DIAGNOSTIC_FAKE_STATE: remoteFile,
    GITHUB_RUN_ID: "",
    GITHUB_RUN_ATTEMPT: "",
    GITHUB_EVENT_NAME: "",
    GITHUB_REF: "",
    GITHUB_REPOSITORY: "",
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
  return {
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
  };
}
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
  assert.equal(terminal.execution.started, true);
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
    head_sha: f.source,
    head_branch: "diagnose/fixture",
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
  remote.logs = `Diagnostic source ${f.source} tree ${f.tree} run 3001 attempt 1 claim ${terminal.claimObject}\nNonqualifying required gate failed: native attribution missing\n`;
  remote.artifacts = [
    {
      id: 501,
      name: "nonqualifying-diagnostic-3001-1",
      expired: false,
      digest: "sha256:" + hash(fs.readFileSync(archive)),
      workflow_run: { head_sha: f.source },
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
      f.source,
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
    spawnSync(process.execPath, [cli, "pre-push"], {
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
    const child = spawn(process.execPath, [cli, op, ...args], {
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
