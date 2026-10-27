import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const awaitHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
import {
  mkdtempSync,
  chmodSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const here = path.dirname(fileURLToPath(import.meta.url)),
  checkpoint = path.join(here, "checkpoint.mjs"),
  recorder = path.join(here, "record-run.mjs");
function run(file, args, env = {}) {
  return spawnSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
}
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "diagnostic-progress-")),
    repo = path.join(root, "repo");
  mkdirSync(repo);
  const git = (...a) => {
    const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  writeFileSync(
    path.join(repo, "app.js"),
    "console.log('observed failure');process.exitCode=1;\n",
  );
  git("add", ".");
  git("commit", "-qm", "base");
  git("switch", "-qc", "diagnose/fixture");
  git("remote", "add", "origin", "https://github.com/fixture/diagnostic.git");
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const issues = path.join(root, "issues.json");
  writeFileSync(
    issues,
    JSON.stringify({
      286: {
        number: 286,
        url: "https://github.com/fixture/diagnostic/issues/286",
        body: "## Parent\n\n#278 - Retro",
        comments: [],
        updatedAt: "2026-10-27T00:00:00Z",
      },
      278: {
        number: 278,
        url: "https://github.com/fixture/diagnostic/issues/278",
        body: "Authoritative complete parent content",
        comments: [{ body: "Preserve this comment" }],
        updatedAt: "2026-10-27T00:00:00Z",
      },
    }),
  );
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    `#!${process.execPath}\nconst fs=require('fs');const v=JSON.parse(fs.readFileSync(${JSON.stringify(issues)}));if(process.argv[2]==='api'&&process.argv.at(-1).endsWith('/comments')){const id=process.argv.at(-1).split('/').at(-2);console.log(JSON.stringify([v[id].comments]));process.exit(0);}if(process.argv[2]==='api'){console.log(fs.readFileSync(${JSON.stringify(path.join(root, "github-approval.json"))},'utf8'));process.exit(0);}const n=process.argv[4];fs.appendFileSync(${JSON.stringify(path.join(root, "fetches"))},n+'\\n');if(!v[n])process.exit(1);if(process.env.TRUNCATE_ISSUE_COMMENTS)v[n].comments=[];console.log(JSON.stringify(v[n]));`,
  );
  chmodSync(gh, 0o700);
  const env = { PATH: bin + path.delimiter + process.env.PATH };
  const probe = `require('fs').appendFileSync(${JSON.stringify(path.join(root, "launched"))},'launched\\n');require(${JSON.stringify(path.join(repo, "app.js"))})`;
  const launchArgs = [
    "--repo",
    repo,
    "--evidence-dir",
    path.join(root, "evidence"),
    "--purpose",
    "green",
    "--summary",
    "--diagnostic-task",
    "286",
    "--",
    process.execPath,
    "-e",
    probe,
  ];
  const plan = path.join(root, "plan.json");
  writeFileSync(
    plan,
    JSON.stringify({
      base: git("rev-parse", "HEAD"),
      gate: "webkit-required",
      nextAction: "Observe whether real probe reports failure",
      owner: "fixture-owner",
      allocation: "fixture-process",
      hypothesis: "Source changes alter the observed failure",
      observation: { expectedExitCode: 0, stdoutIncludes: "observed success" },
      allowance: 2,
      sourcePaths: ["app.js"],
      entrypoints: ["app.js"],
      launch: { command: process.execPath, args: ["-e", probe] },
    }),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    repo,
    git,
    env,
    issues,
    plan,
    start() {
      if (!existsSync(path.join(repo, ".diagnostic-task.json"))) {
        const prepared = run(
          checkpoint,
          ["prepare", "--repo", repo, "--task", "286"],
          env,
        );
        assert.equal(prepared.status, 0, prepared.stderr);
        git("add", ".diagnostic-task.json");
        git("commit", "-qm", "bind diagnostic source manifest");
      }
      return run(
        checkpoint,
        ["start", "--repo", repo, "--task", "286", "--input", plan],
        env,
      );
    },
    inspect() {
      return run(checkpoint, ["inspect", "--repo", repo, "--task", "286"], env);
    },
    marker: path.join(root, "launched"),
    launchArgs,
    launch(extra = []) {
      const a = [...launchArgs];
      a.splice(a.indexOf("--"), 0, ...extra);
      return run(recorder, a, env);
    },
  };
}
test("diagnostic recorder refuses missing durable state before starting a child", (t) => {
  const f = fixture(t),
    r = f.launch();
  assert.notEqual(r.status, 0);
  assert.equal(
    existsSync(f.marker),
    false,
    "no diagnostic child may start without durable authorization",
  );
  assert.match(r.stderr, /diagnostic.*state/i);
});
test("diagnostic recorder rejects tampered state without launching", (t) => {
  const f = fixture(t),
    dir = path.join(f.repo, ".git", "diagnostic-progress");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "current.json"), "{}");
  const r = f.launch();
  assert.equal(
    existsSync(f.marker),
    false,
    "unreadable or unbound diagnostic state cannot authorize a child",
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /state|journal|integrity/i);
});

test("a fresh process given only the task fetches complete parent authority and admissions consume the same durable allowance", (t) => {
  const f = fixture(t),
    started = f.start();
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).sourceIssue.number, 278);
  assert.equal(
    readFileSync(path.join(f.root, "fetches"), "utf8"),
    "286\n278\n286\n278\n",
  );
  const launched = f.launch();
  assert.notEqual(launched.status, 0);
  assert.equal(readFileSync(f.marker, "utf8"), "launched\n");
  const next = f.inspect();
  assert.equal(next.status, 0, next.stderr);
  assert.equal(
    JSON.parse(next.stdout).remaining,
    1,
    "the real recorder consumes one attempt before child spawn",
  );
  const again = f.launch();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).observed, true);
  assert.equal(readFileSync(f.marker, "utf8"), "launched\n");
});
test("an active failed investigation prevents caller-asserted completed release checkpoints", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  assert.equal(f.launch().status, 1);
  const s = JSON.parse(f.inspect().stdout),
    attempt = s.attempts[0],
    evidence = attempt.result;
  const record = {
    schemaVersion: 1,
    id: "release-fixture",
    revision: 1,
    source: {
      commit: s.source.commit,
      tree: s.source.tree,
      base: s.source.base,
    },
    status: "complete",
    requiredGates: [
      {
        id: "required",
        status: "passed",
        summary: "Caller asserts a release pass",
        evidence: [
          {
            id: "caller-assertion",
            ...evidence,
            sourceCommit: s.source.commit,
            sourceTree: s.source.tree,
          },
        ],
      },
    ],
    followUps: [],
    nextAction: null,
  };
  const input = path.join(f.root, "release.json");
  writeFileSync(input, JSON.stringify(record));
  const r = run(
    checkpoint,
    [
      "create",
      "--repo",
      f.repo,
      "--input",
      input,
      "--record",
      path.join(f.root, "completed.json"),
    ],
    f.env,
  );
  assert.notEqual(
    r.status,
    0,
    "caller-marked passed gate cannot override an unresolved durable investigation",
  );
  assert.equal(existsSync(path.join(f.root, "completed.json")), false);
  assert.match(r.stderr, /Diagnostic required gate.*incomplete/);
});
function command(f, op, extra = []) {
  return run(
    checkpoint,
    [op, "--repo", f.repo, "--task", "286", ...extra],
    f.env,
  );
}
function consume(f) {
  const attempt = JSON.parse(f.inspect().stdout).attempts.at(-1);
  return command(f, "consume", ["--attempt", attempt.id]);
}
function change(f, code) {
  writeFileSync(path.join(f.repo, "app.js"), code);
  f.git("commit", "-qam", "material input change");
  return command(f, "change-source", ["--input", f.plan]);
}
test("consumption derives failed observations from actual output and a finite allowance survives branch and observer commits", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  assert.equal(f.launch().status, 1);
  const unconsumed = f.launch(["--diagnostic-request", "another"]);
  assert.notEqual(unconsumed.status, 0);
  assert.match(unconsumed.stderr, /must be consumed/);
  const consumed = consume(f);
  assert.equal(consumed.status, 0, consumed.stderr);
  assert.equal(
    JSON.parse(consumed.stdout).attempts[0].consumption.passed,
    false,
  );
  const identical = f.launch(["--diagnostic-request", "another"]);
  assert.notEqual(identical.status, 0);
  assert.match(identical.stderr, /identical failed inputs/);
  f.git("switch", "-qc", "renamed-ordinary-branch");
  writeFileSync(path.join(f.repo, "notes.md"), "observer wording");
  f.git("add", "notes.md");
  f.git("commit", "-qm", "observer only");
  const observer = command(f, "change-source", ["--input", f.plan]);
  assert.notEqual(observer.status, 0);
  assert.match(observer.stderr, /material tracked input change/);
  assert.equal(JSON.parse(f.inspect().stdout).remaining, 1);
  const changed = change(
    f,
    "console.log('still observed failure');process.exitCode=1;\n",
  );
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(f.launch(["--diagnostic-request", "material"]).status, 1);
  assert.equal(consume(f).status, 0);
  const exhausted = f.launch(["--diagnostic-request", "third"]);
  assert.notEqual(exhausted.status, 0);
  assert.match(exhausted.stderr, /allowance exhausted.*webkit-required.*Next:/);
  const current = JSON.parse(f.inspect().stdout);
  assert.equal(current.remaining, 0);
  assert.equal(current.attempts.length, 2);
  assert.equal(current.attempts[0].consumption.passed, false);
  assert.notEqual(
    f.start().status,
    0,
    "starting from a new context cannot renew allowance",
  );
});
test("stale authority dirty source and changed result bytes refuse without further children", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  const issues = JSON.parse(readFileSync(f.issues));
  issues[278].comments.push({ body: "new required condition" });
  writeFileSync(f.issues, JSON.stringify(issues));
  const stale = f.launch();
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /source issue changed or stale/);
  assert.equal(existsSync(f.marker), false);
  issues[278].comments.pop();
  writeFileSync(f.issues, JSON.stringify(issues));
  writeFileSync(path.join(f.repo, "app.js"), "dirty source");
  assert.notEqual(f.launch().status, 0);
  assert.equal(existsSync(f.marker), false);
  f.git("checkout", "--", "app.js");
  assert.equal(f.launch().status, 1);
  const attempt = JSON.parse(f.inspect().stdout).attempts[0];
  writeFileSync(attempt.result.path, '{"execution":{"exitCode":0}}');
  const tampered = consume(f);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /immutable result fingerprint changed/);
  assert.equal(JSON.parse(f.inspect().stdout).remaining, 1);
});
test("two fresh concurrent public recorder processes admit exactly one identical request", async (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  const launch = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [recorder, ...f.launchArgs], {
        env: { ...process.env, ...f.env },
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (b) => (stdout += b));
      child.stderr.on("data", (b) => (stderr += b));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  const results = await Promise.all([launch(), launch()]);
  assert.deepEqual(
    results.map((r) => r.status).sort(),
    [0, 1],
    JSON.stringify(results),
  );
  assert.equal(readFileSync(f.marker, "utf8"), "launched\n");
  const state = JSON.parse(f.inspect().stdout);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.remaining, 1);
});
test("independently consumed passing output completes only the actual current source", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  assert.equal(f.launch().status, 1);
  assert.equal(consume(f).status, 0);
  assert.equal(change(f, "console.log('observed success');\n").status, 0);
  const launched = f.launch(["--diagnostic-request", "repaired"]);
  assert.equal(launched.status, 0, launched.stderr);
  const consumed = consume(f);
  assert.equal(consumed.status, 0, consumed.stderr);
  assert.equal(JSON.parse(consumed.stdout).status, "complete");
  const published = command(f, "verify-publication");
  assert.notEqual(published.status, 0);
  assert.match(published.stderr, /Diagnostic-only source/);
  assert.equal(
    JSON.parse(f.inspect().stdout).attempts[0].consumption.passed,
    false,
    "the earlier failure remains durable after a pass",
  );
});
test("a predicted diagnostic failure cannot pay an unresolved required gate", (t) => {
  const f = fixture(t),
    plan = JSON.parse(readFileSync(f.plan));
  plan.observation = {
    expectedExitCode: 1,
    stdoutIncludes: "observed failure",
  };
  writeFileSync(f.plan, JSON.stringify(plan));
  assert.equal(f.start().status, 0);
  assert.equal(f.launch().status, 1);
  const result = consume(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).status,
    "open",
    "matching a hypothesis while the actual command fails does not pass the required gate",
  );
});
test("portable CI independently verifies a signed admitted attempt in a separate clone and refuses tampering retry and missing manifest", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  const plan = JSON.parse(readFileSync(f.plan)),
    input = path.join(f.root, "admit.json");
  writeFileSync(
    input,
    JSON.stringify({ ...plan.launch, request: "hosted-attempt" }),
  );
  const admitted = command(f, "admit", [
    "--input",
    input,
    "--record",
    path.join(f.root, "dispatch-result.json"),
  ]);
  assert.equal(admitted.status, 0, admitted.stderr);
  const attempt = JSON.parse(admitted.stdout).attempt.id,
    bundle = path.join(f.root, "portable.json");
  const exported = command(f, "export", [
    "--attempt",
    attempt,
    "--record",
    bundle,
  ]);
  assert.equal(exported.status, 0, exported.stderr);
  const clone = path.join(f.root, "fresh-clone");
  const cloned = spawnSync("git", ["clone", "-q", f.repo, clone], {
    encoding: "utf8",
  });
  assert.equal(cloned.status, 0, cloned.stderr);
  spawnSync("git", [
    "-C",
    clone,
    "remote",
    "set-url",
    "origin",
    "https://github.com/fixture/diagnostic.git",
  ]);
  assert.equal(
    existsSync(path.join(clone, ".git", "diagnostic-progress")),
    false,
  );
  const args = [
      "verify-ci",
      "--repo",
      clone,
      "--input",
      bundle,
      "--commit",
      f.git("rev-parse", "HEAD"),
    ],
    verified = run(checkpoint, args, f.env);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).remaining, 1);
  assert.equal(JSON.parse(verified.stdout).attempt, attempt);
  const retry = run(checkpoint, args, { ...f.env, GITHUB_RUN_ATTEMPT: "2" });
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /newly admitted/);
  const forged = JSON.parse(readFileSync(bundle));
  forged.body.state.allowance = 999;
  writeFileSync(bundle, JSON.stringify(forged));
  const tampered = run(checkpoint, args, f.env);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /signature invalid/);
  spawnSync("git", ["-C", clone, "config", "user.name", "Fixture"]);
  spawnSync("git", [
    "-C",
    clone,
    "config",
    "user.email",
    "fixture@example.test",
  ]);
  spawnSync("git", ["-C", clone, "rm", "-q", ".diagnostic-task.json"]);
  spawnSync("git", [
    "-C",
    clone,
    "commit",
    "-qm",
    "try removing governed identity",
  ]);
  const removed = run(
    checkpoint,
    ["verify-ci", "--repo", clone, "--input", bundle],
    f.env,
  );
  assert.notEqual(removed.status, 0);
  assert.match(removed.stderr, /lost its committed source manifest/);
});
test("bounded extension requires exact source and current journal authorization evidence and retains failures", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  assert.equal(f.launch().status, 1);
  assert.equal(consume(f).status, 0);
  assert.equal(
    change(f, "console.log('failure changed');process.exitCode=1;\n").status,
    0,
  );
  assert.equal(f.launch(["--diagnostic-request", "second"]).status, 1);
  assert.equal(consume(f).status, 0);
  const before = JSON.parse(f.inspect().stdout),
    evidence = path.join(f.root, "human-authorization.txt");
  writeFileSync(
    evidence,
    "Explicit bounded extension approved by the fixture user.",
  );
  const approval = path.join(f.root, "approval.json"),
    record = {
      task: 286,
      repository: "fixture/diagnostic",
      priorDigest: before.journalDigest,
      sourceCommit: before.source.commit,
      additionalAttempts: 1,
      approvedBy: "fixture",
      commentUrl:
        "https://github.com/fixture/diagnostic/issues/999#issuecomment-123",
      reason: "One more distinct source repair is authorized",
      authorizationEvidence: {
        path: evidence,
        sha256: awaitHash(readFileSync(evidence)),
      },
    };
  const approvalBody = JSON.stringify(
    Object.fromEntries(
      [
        "task",
        "repository",
        "priorDigest",
        "sourceCommit",
        "additionalAttempts",
        "reason",
      ].map((k) => [k, record[k]]),
    ),
  );
  writeFileSync(evidence, approvalBody);
  record.authorizationEvidence.sha256 = awaitHash(readFileSync(evidence));
  writeFileSync(
    path.join(f.root, "github-approval.json"),
    JSON.stringify({
      id: 123,
      html_url: record.commentUrl,
      user: { login: "fixture" },
      author_association: "OWNER",
      body: approvalBody,
    }),
  );
  writeFileSync(approval, JSON.stringify(record));
  const extended = command(f, "extend", ["--approval", approval]);
  assert.equal(extended.status, 0, extended.stderr);
  const state = JSON.parse(f.inspect().stdout);
  assert.equal(state.remaining, 1);
  assert.equal(state.attempts.length, 2);
  assert.equal(state.attempts[0].consumption.passed, false);
  const replay = command(f, "extend", ["--approval", approval]);
  assert.notEqual(replay.status, 0);
  assert.match(replay.stderr, /exact current journal/);
  assert.equal(
    change(f, "console.log('third material failure');process.exitCode=1;\n")
      .status,
    0,
  );
  writeFileSync(evidence, "Changed authorization evidence");
  const unauthorized = f.launch(["--diagnostic-request", "third"]);
  assert.notEqual(unauthorized.status, 0);
  assert.equal(
    readFileSync(f.marker, "utf8"),
    "launched\nlaunched\n",
    "changed authorization evidence cannot admit a third child",
  );
});

test("a caller-authored approval file cannot impersonate the repository approval authority", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  const state = JSON.parse(f.inspect().stdout),
    evidence = path.join(f.root, "self-assertion.txt");
  writeFileSync(evidence, "I claim the user approved more probes.");
  const approval = path.join(f.root, "forged-approval.json");
  writeFileSync(
    approval,
    JSON.stringify({
      task: 286,
      repository: "fixture/diagnostic",
      priorDigest: state.journalDigest,
      sourceCommit: state.source.commit,
      additionalAttempts: 1,
      approvedBy: "fixture-user",
      reason: "Self asserted approval must not grant execution",
      authorizationEvidence: {
        path: evidence,
        sha256: awaitHash(readFileSync(evidence)),
      },
    }),
  );
  const extended = command(f, "extend", ["--approval", approval]);
  assert.notEqual(
    extended.status,
    0,
    "a caller assertion alone cannot authorize an allowance extension",
  );
  assert.equal(JSON.parse(f.inspect().stdout).remaining, 2);
});

test("source prerequisites include paginated comments beyond the issue summary", (t) => {
  const f = fixture(t);
  f.env.TRUNCATE_ISSUE_COMMENTS = "1";
  const result = f.start();
  assert.equal(result.status, 0, result.stderr);
  const expected = JSON.parse(readFileSync(f.issues))[278];
  assert.equal(
    JSON.parse(result.stdout).sourceIssue.fingerprint,
    awaitHash(JSON.stringify(expected)),
    "the complete comment source must be bound even when the summary omits comments",
  );
});

test("an owner extension comment appended to the bound issue updates only that explicit authority append", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  const state = JSON.parse(f.inspect().stdout),
    authorization = {
      task: 286,
      repository: "fixture/diagnostic",
      priorDigest: state.journalDigest,
      sourceCommit: state.source.commit,
      additionalAttempts: 1,
      reason: "One exact bounded additional diagnostic attempt is authorized",
    };
  const body = JSON.stringify(authorization),
    evidence = path.join(f.root, "owner-comment.txt");
  writeFileSync(evidence, body);
  const comment = {
    id: 124,
    html_url:
      "https://github.com/fixture/diagnostic/issues/286#issuecomment-124",
    user: { login: "fixture" },
    author_association: "OWNER",
    body,
  };
  writeFileSync(
    path.join(f.root, "github-approval.json"),
    JSON.stringify(comment),
  );
  const issues = JSON.parse(readFileSync(f.issues));
  issues[286].comments.push(comment);
  issues[286].updatedAt = "2026-10-27T00:01:00Z";
  writeFileSync(f.issues, JSON.stringify(issues));
  const approval = path.join(f.root, "owner-approval.json");
  writeFileSync(
    approval,
    JSON.stringify({
      ...authorization,
      approvedBy: "fixture",
      commentUrl: comment.html_url,
      authorizationEvidence: {
        path: evidence,
        sha256: awaitHash(readFileSync(evidence)),
      },
    }),
  );
  const extended = command(f, "extend", ["--approval", approval]);
  assert.equal(extended.status, 0, extended.stderr);
  assert.equal(
    JSON.parse(f.inspect().stdout).remaining,
    3,
    "the explicit comment adds exactly its bounded allowance",
  );
  assert.equal(
    f.launch().status,
    1,
    "a new context can launch using the coherently updated source authority",
  );
});

test("an owner approval append cannot hide an unrelated task scope change", (t) => {
  const f = fixture(t);
  assert.equal(f.start().status, 0);
  const state = JSON.parse(f.inspect().stdout);
  const authorized = {
    task: 286,
    repository: "fixture/diagnostic",
    priorDigest: state.journalDigest,
    sourceCommit: state.source.commit,
    additionalAttempts: 1,
    reason: "One exact bounded additional diagnostic attempt is authorized",
  };
  const body = JSON.stringify(authorized),
    evidence = path.join(f.root, "scope-comment.txt");
  writeFileSync(evidence, body);
  const comment = {
    id: 125,
    html_url:
      "https://github.com/fixture/diagnostic/issues/286#issuecomment-125",
    user: { login: "fixture" },
    author_association: "OWNER",
    body,
  };
  writeFileSync(
    path.join(f.root, "github-approval.json"),
    JSON.stringify(comment),
  );
  const issues = JSON.parse(readFileSync(f.issues));
  issues[286].comments.push(comment);
  issues[286].body += "\nUnrelated changed diagnostic scope";
  writeFileSync(f.issues, JSON.stringify(issues));
  const approval = path.join(f.root, "scope-approval.json");
  writeFileSync(
    approval,
    JSON.stringify({
      ...authorized,
      approvedBy: "fixture",
      commentUrl: comment.html_url,
      authorizationEvidence: {
        path: evidence,
        sha256: awaitHash(readFileSync(evidence)),
      },
    }),
  );
  const result = command(f, "extend", ["--approval", approval]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source issue changed|stale/);
  assert.equal(
    JSON.parse(f.inspect().stdout).remaining,
    2,
    "unrelated scope cannot acquire allowance through a real owner comment",
  );
});
