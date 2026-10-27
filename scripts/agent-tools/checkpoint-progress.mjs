// The journal is durable enforcement for supported commands, not a security
// boundary against an administrator/writer who can replace Git metadata or code.
import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  randomUUID,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { spawnSync } from "node:child_process";
const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw Error(`Diagnostic Git identity unavailable: ${r.stderr}`);
  return r.stdout.trim();
}
export function diagnosticDirectory(repo) {
  return path.join(
    fs.realpathSync(
      git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    ),
    "diagnostic-progress",
  );
}
function read(file) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 2 * 1024 * 1024
  )
    throw Error("Diagnostic state must be a bounded regular, unlinked file.");
  return fs.readFileSync(file, "utf8");
}
function immutable(file, value) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function syncDir(dir) {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
async function locked(repo, action) {
  const dir = diagnosticDirectory(repo);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "lock");
  let acquired = false;
  for (let i = 0; i < 250; i++) {
    try {
      fs.mkdirSync(lock);
      acquired = true;
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  if (!acquired)
    throw Error(
      "Diagnostic journal busy or interrupted lock; no child admitted. Owner must inspect the preserved lock.",
    );
  try {
    return await action(dir);
  } finally {
    fs.rmdirSync(lock);
  }
}
function load(dir) {
  const head = JSON.parse(read(path.join(dir, "current.json")));
  if (
    !Number.isSafeInteger(head.revision) ||
    head.revision < 1 ||
    !/^[a-f0-9]{64}$/.test(head.digest)
  )
    throw Error("Diagnostic state journal integrity invalid.");
  const revisions = fs
    .readdirSync(dir)
    .filter((x) => /^revision-\d+\.json$/.test(x));
  if (revisions.length !== head.revision)
    throw Error("Diagnostic state journal revision mismatch or rollback.");
  let prior = null,
    state;
  for (let i = 1; i <= head.revision; i++) {
    const raw = read(path.join(dir, `revision-${i}.json`));
    state = JSON.parse(raw);
    if (state.revision !== i || state.previousDigest !== prior)
      throw Error("Diagnostic state journal integrity invalid.");
    prior = digest(raw);
  }
  if (
    prior !== head.digest ||
    state.schemaVersion !== 1 ||
    !state.task ||
    !state.sourceIssue ||
    !Array.isArray(state.attempts)
  )
    throw Error("Diagnostic state journal integrity invalid.");
  return { state, head };
}
function save(dir, state, prior = null) {
  state.revision = (prior?.revision ?? 0) + 1;
  state.previousDigest = prior?.digest ?? null;
  const file = path.join(dir, `revision-${state.revision}.json`);
  immutable(file, state);
  const raw = read(file),
    head = { revision: state.revision, digest: digest(raw) },
    temp = path.join(dir, `head-${randomUUID()}.tmp`);
  immutable(temp, head);
  fs.renameSync(temp, path.join(dir, "current.json"));
  syncDir(dir);
  return head;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000)
    throw Error(`Diagnostic ${label} required.`);
  return value;
}
function slug(repo) {
  const remote = git(repo, "config", "--get", "remote.origin.url"),
    match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match)
    throw Error("Diagnostic repository needs an exact GitHub origin identity.");
  return match[1];
}
function fetchIssue(repository, number) {
  const r = spawnSync(
    "gh",
    [
      "issue",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      "number,url,body,comments,updatedAt",
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw Error(
      `Diagnostic required source issue #${number} unreadable: ${r.stderr || r.error?.message}`,
    );
  const issue = JSON.parse(r.stdout);
  if (
    issue.number !== Number(number) ||
    issue.url !== `https://github.com/${repository}/issues/${number}` ||
    typeof issue.body !== "string" ||
    !Array.isArray(issue.comments)
  )
    throw Error(
      "Diagnostic source issue identity or complete body/comments invalid.",
    );
  // The issue summary is not the completeness authority for comments. Fetch
  // every REST page explicitly before binding the starting source fingerprint.
  const comments = spawnSync(
    "gh",
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/issues/${number}/comments`,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (comments.status !== 0)
    throw Error("Diagnostic complete source comments unreadable.");
  const pages = JSON.parse(comments.stdout);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
    throw Error("Diagnostic complete comment pagination invalid.");
  issue.comments = pages.flat();
  return { issue, fingerprint: digest(issue) };
}
function authority(repo, task) {
  const repository = slug(repo),
    taskSource = fetchIssue(repository, task),
    parent = taskSource.issue.body.match(/## Parent\s+[\s\S]*?#(\d+)/);
  if (!parent)
    throw Error(
      "Diagnostic task must identify its authoritative Parent issue.",
    );
  return {
    repository,
    task: taskSource,
    parent: fetchIssue(repository, parent[1]),
  };
}
function verifyApprovalComment(repository, approval, expectedBody) {
  const match = String(approval.commentUrl ?? "").match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+#issuecomment-(\d+)$/,
  );
  if (!match || match[1] !== repository)
    throw Error(
      "Diagnostic extension requires a repository-owner GitHub approval comment.",
    );
  const response = spawnSync(
    "gh",
    ["api", `repos/${repository}/issues/comments/${match[2]}`],
    { encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (response.status !== 0)
    throw Error("Diagnostic approval authority unreadable.");
  const comment = JSON.parse(response.stdout);
  if (
    comment.html_url !== approval.commentUrl ||
    comment.user?.login !== repository.split("/")[0] ||
    comment.user.login !== approval.approvedBy ||
    comment.author_association !== "OWNER" ||
    comment.body !== expectedBody
  )
    throw Error(
      "Diagnostic allowance extension lacks an exact repository-owner approval.",
    );
  const authorized = JSON.parse(comment.body);
  for (const field of [
    "task",
    "repository",
    "priorDigest",
    "sourceCommit",
    "additionalAttempts",
    "reason",
  ])
    if (authorized[field] !== approval[field])
      throw Error(
        "Diagnostic approval comment does not authorize this exact bounded extension.",
      );
  return {
    url: comment.html_url,
    id: comment.id,
    approvedBy: comment.user.login,
    body: comment.body,
  };
}
function exactApprovalAppend(previous, current, approvalComment) {
  const withoutComments = (issue) =>
    Object.fromEntries(
      Object.entries(issue).filter(
        ([key]) => !["comments", "updatedAt"].includes(key),
      ),
    );
  if (
    JSON.stringify(withoutComments(previous)) !==
      JSON.stringify(withoutComments(current)) ||
    current.comments.length !== previous.comments.length + 1 ||
    previous.comments.some(
      (comment, index) =>
        JSON.stringify(comment) !== JSON.stringify(current.comments[index]),
    )
  )
    return false;
  const last = current.comments.at(-1);
  return (
    last.id === approvalComment.id &&
    last.html_url === approvalComment.url &&
    last.body === approvalComment.body &&
    last.user?.login === approvalComment.approvedBy &&
    last.author_association === "OWNER"
  );
}
function verifyAuthority(
  repo,
  state,
  portable = false,
  approvalComment = null,
) {
  for (const event of state.events ?? []) {
    if (
      event.type === "explicit-extension" &&
      !portable &&
      (digest(read(event.approval.path)) !== event.approval.sha256 ||
        digest(read(event.authorizationEvidence.path)) !==
          event.authorizationEvidence.sha256)
    )
      throw Error(
        "Diagnostic extension authorization evidence changed or missing.",
      );
  }
  for (const event of state.events ?? [])
    if (event.type === "explicit-extension")
      verifyApprovalComment(
        state.repository,
        {
          ...JSON.parse(event.approvalComment.body),
          commentUrl: event.approvalComment.url,
          approvedBy: event.approvedBy,
        },
        event.approvalComment.body,
      );
  const current = authority(repo, state.task);
  const taskSame = current.task.fingerprint === state.taskIssue.fingerprint,
    parentSame = current.parent.fingerprint === state.sourceIssue.fingerprint;
  const authorizedAppend =
    approvalComment &&
    ((taskSame &&
      exactApprovalAppend(
        state.sourceIssue.issue,
        current.parent.issue,
        approvalComment,
      )) ||
      (parentSame &&
        exactApprovalAppend(
          state.taskIssue.issue,
          current.task.issue,
          approvalComment,
        )));
  if (
    current.repository !== state.repository ||
    (!(taskSame && parentSame) && !authorizedAppend)
  )
    throw Error(
      "Diagnostic source issue changed or stale; preserve state and reconcile the changed authority before admission.",
    );
  return current;
}
function source(repo, base, paths) {
  const commit = git(repo, "rev-parse", "HEAD^{commit}"),
    tree = git(repo, "rev-parse", "HEAD^{tree}");
  if (
    !/^[a-f0-9]{40}$/.test(base) ||
    spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", base, commit])
      .status !== 0
  )
    throw Error("Diagnostic base must be an exact ancestor.");
  if (git(repo, "status", "--porcelain", "--untracked-files=no"))
    throw Error("Diagnostic source must be committed and clean.");
  return {
    commit,
    tree,
    base,
    inputFingerprint: digest(
      paths.map((p) => [p, git(repo, "ls-tree", "-r", commit, "--", p)]),
    ),
  };
}
function verifySource(repo, state) {
  const actual = source(repo, state.source.base, state.sourcePaths);
  if (
    actual.commit !== state.source.commit ||
    actual.tree !== state.source.tree
  )
    throw Error(
      "Diagnostic state source is stale; use checkpoint change-source for a material change.",
    );
  return actual;
}
function summary(s) {
  return {
    schemaVersion: s.schemaVersion,
    task: s.task,
    repository: s.repository,
    source: s.source,
    sourceIssue: {
      number: s.sourceIssue.issue.number,
      url: s.sourceIssue.issue.url,
      fingerprint: s.sourceIssue.fingerprint,
    },
    owner: s.owner,
    allocation: s.allocation,
    gate: s.gate,
    status: s.status,
    remaining: s.allowance - s.attempts.length,
    nextAction: s.nextAction,
    hypothesis: s.hypothesis,
    observation: s.observation,
    attempts: s.attempts,
    events: s.events,
    allowance: s.allowance,
    revision: s.revision,
  };
}
function requestedTask(repo, context = {}) {
  const marker = manifestAt(repo, git(repo, "rev-parse", "HEAD"));
  const explicit =
    context.task ??
    process.env.CHAIN_DIAGNOSTIC_TASK ??
    (context.diagnostic ? marker?.task : null);
  const args = context.args ?? [];
  // These are existing actual diagnostic consumers in the independently owned
  // WebKit branch. Keeping their identity here also rejects renamed branches.
  const known =
    args.some(
      (a) =>
        String(a)
          .replaceAll("\\", "/")
          .endsWith("/button-safety-mobile-memory.mjs") ||
        a === "scripts/button-safety-mobile-memory.mjs",
    ) && args.includes("--run");
  if (known && marker) return String(marker.task);
  const dir = diagnosticDirectory(repo),
    head = path.join(dir, "current.json");
  if (explicit) return String(explicit);
  if (fs.existsSync(head)) {
    const { state } = load(dir);
    if (
      args.some((a) =>
        state.entrypoints?.includes(path.relative(repo, path.resolve(repo, a))),
      )
    )
      return String(state.task);
  }
  if (known)
    throw Error(
      "Diagnostic durable state/task missing for supported WebKit --run launch; supply --diagnostic-task.",
    );
  return null;
}
export function assertDiagnosticLaunchAllowed(repo, context = {}) {
  const task = requestedTask(repo, context);
  if (!task) return null;
  const dir = diagnosticDirectory(repo);
  if (!fs.existsSync(path.join(dir, "current.json")))
    throw Error(
      "Diagnostic durable state missing; run agent:checkpoint start --repo <repo> --task <issue> --input <plan>.",
    );
  const { state } = load(dir);
  if (String(state.task) !== task)
    throw Error("Diagnostic durable state task mismatch.");
  verifySource(repo, state);
  return state;
}
const MANIFEST = ".diagnostic-task.json";
function manifestAt(repo, commit) {
  const r = spawnSync("git", ["-C", repo, "show", `${commit}:${MANIFEST}`], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  let marker;
  try {
    marker = JSON.parse(r.stdout);
  } catch {
    throw Error("Diagnostic source manifest unreadable.");
  }
  if (
    marker.schemaVersion !== 1 ||
    !Number.isSafeInteger(marker.task) ||
    marker.mode !== "diagnostic-only" ||
    typeof marker.publicKey !== "string"
  )
    throw Error("Diagnostic source manifest invalid.");
  return marker;
}
function diagnosticSource(repo, commit) {
  const marker = manifestAt(repo, commit);
  if (marker) return marker;
  const history = spawnSync(
    "git",
    ["-C", repo, "log", "-1", "--format=%H", commit, "--", MANIFEST],
    { encoding: "utf8" },
  );
  if (history.stdout?.trim())
    throw Error(
      "Known governed diagnostic source lost its committed source manifest; publication refused.",
    );
  const workflow = spawnSync(
    "git",
    ["-C", repo, "show", `${commit}:.github/workflows/data-safety.yml`],
    { encoding: "utf8" },
  );
  if (
    /name: Diagnostic|FROZEN_APP_COMMIT|CHAIN_DIAGNOSTIC_/.test(
      workflow.stdout ?? "",
    )
  )
    throw Error(
      "Known diagnostic source is missing its governed source manifest; product publication refused.",
    );
  return null;
}
// One-use local handoff from the protected, online-verified governance parent.
// Kernel identity does not attest JavaScript; same-user/admin replacement of
// protected workflow code or processes is outside the supported guarantee.
let consumed = false;
export function rejectDiagnosticNodeInjection(
  env = process.env,
  args = process.execArgv,
) {
  if (
    env.NODE_OPTIONS ||
    env.NODE_PATH ||
    args.some((arg) =>
      /^(?:-r|--require(?:=|$)|--import(?:=|$)|--loader(?:=|$)|--experimental-loader(?:=|$))/.test(
        arg,
      ),
    )
  )
    throw Error(
      "Diagnostic runtime refuses Node preload or module-path injection.",
    );
}
export function diagnosticProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw Error("Diagnostic channel PID invalid.");
  if (process.platform === "linux") {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"),
      tail = stat.slice(stat.lastIndexOf(")") + 2).split(" "),
      status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    return {
      pid,
      parentPid: Number(tail[1]),
      start: tail[19],
      uid: Number(status.match(/^Uid:\s+(\d+)/m)?.[1]),
      executable: fs.readlinkSync(`/proc/${pid}/exe`),
      argv: fs
        .readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .split("\0")
        .filter(Boolean),
    };
  }
  if (process.platform === "darwin") {
    const row = spawnSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "ppid=,uid=,lstart="],
      { encoding: "utf8" },
    );
    if (row.status !== 0) throw Error("Diagnostic parent process unavailable.");
    const parsed = row.stdout.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!parsed) throw Error("Diagnostic process identity unavailable.");
    // ps identity supplements the protected workflow trust root; argv is not an attestation.
    return {
      pid,
      parentPid: Number(parsed[1]),
      uid: Number(parsed[2]),
      start: parsed[3],
      executable: spawnSync(
        "/usr/sbin/lsof",
        ["-a", "-p", String(pid), "-d", "txt", "-Fn"],
        {
          encoding: "utf8",
          timeout: 1500,
          maxBuffer: 1024 * 1024,
        },
      )
        .stdout.split("\n")
        .find((line) => line.startsWith("n"))
        ?.slice(1),
      argv: spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
      })
        .stdout.trim()
        .split(/\s+/),
    };
  }
  throw Error(
    "Diagnostic inherited channel requires Linux or macOS kernel process identity.",
  );
}
export function diagnosticChannelPayload(binding, childPid) {
  rejectDiagnosticNodeInjection();
  return {
    ...binding,
    version: 1,
    nonce: randomUUID(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 5000,
    parent: diagnosticProcessIdentity(process.pid),
    child: diagnosticProcessIdentity(childPid),
  };
}
export function consumeDiagnosticChannel(context, repo) {
  rejectDiagnosticNodeInjection();
  if (consumed)
    throw Error("Diagnostic inherited authorization channel already consumed.");
  consumed = true;
  let raw = Buffer.alloc(0),
    payload;
  try {
    if (!fs.fstatSync(3).isSocket() && !fs.fstatSync(3).isFIFO())
      throw Error("not an inherited pipe");
    const until = Date.now() + 1500,
      chunk = Buffer.alloc(16385);
    for (;;) {
      try {
        const n = fs.readSync(3, chunk, 0, chunk.length, null);
        if (!n) break;
        raw = Buffer.concat([raw, chunk.subarray(0, n)]);
        if (raw.length > 16384) throw Error("oversized authorization");
      } catch (error) {
        if (error.code !== "EAGAIN") throw error;
        if (Date.now() >= until) throw Error("authorization channel timed out");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    payload = JSON.parse(raw.toString());
  } catch (error) {
    throw Error(
      "Diagnostic inherited parent authorization missing or invalid: " +
        error.message,
    );
  } finally {
    try {
      fs.closeSync(3);
    } catch {}
  }
  if (
    payload.version !== 1 ||
    !/^[a-f0-9-]{36}$/.test(payload.nonce ?? "") ||
    !Number.isSafeInteger(payload.issuedAt) ||
    payload.issuedAt > Date.now() ||
    payload.expiresAt - payload.issuedAt !== 5000 ||
    Date.now() > payload.expiresAt
  )
    throw Error("Diagnostic inherited authorization stale or malformed.");
  for (const key of [
    "governance",
    "source",
    "sourceRef",
    "claim",
    "runId",
    "runAttempt",
  ])
    if (payload[key] !== context[key])
      throw Error(
        "Diagnostic inherited authorization context mismatch: " + key,
      );
  const actualParent = diagnosticProcessIdentity(process.ppid),
    actualChild = diagnosticProcessIdentity(process.pid);
  if (
    JSON.stringify(actualParent) !== JSON.stringify(payload.parent) ||
    JSON.stringify(actualChild) !== JSON.stringify(payload.child) ||
    payload.child.parentPid !== payload.parent.pid ||
    payload.parent.pid !== process.ppid ||
    payload.parent.uid !== process.getuid() ||
    payload.child.uid !== process.getuid()
  )
    throw Error("Diagnostic inherited parent/child kernel identity changed.");
  const gov = fs.realpathSync(payload.governanceRoot),
    cli = fs.realpathSync(path.join(gov, "scripts/release-evidence.mjs"));
  if (
    payload.parent.executable !== fs.realpathSync(process.execPath) ||
    payload.parent.argv[1] !== cli ||
    !payload.parent.argv.includes("diagnostic-ci-run") ||
    git(gov, "rev-parse", "HEAD") !== context.governance ||
    git(gov, "status", "--porcelain", "--untracked-files=all") ||
    fs.realpathSync(repo) === gov
  )
    throw Error(
      "Diagnostic channel parent is not the bound immutable governance invocation.",
    );
  return {
    ...context,
    channel: {
      nonce: payload.nonce,
      parentPid: payload.parent.pid,
      childPid: process.pid,
      issuedAt: payload.issuedAt,
      consumed: true,
    },
  };
}

// Metadata forwarded only after the host has consumed its parent channel.
export function diagnosticDescendantContext(
  env,
  commit = env.CHAIN_TEST_SOURCE_SHA,
) {
  const sha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
  if (
    env.CI !== "true" ||
    env.CHAIN_TEST_EVENT_POLICY !== "diagnostic-workflow-dispatch-v1" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !sha(env.CHAIN_DIAGNOSTIC_GOVERNANCE) ||
    env.GITHUB_SHA !== env.CHAIN_DIAGNOSTIC_GOVERNANCE ||
    !sha(commit) ||
    env.CHAIN_DIAGNOSTIC_SOURCE !== commit ||
    env.CHAIN_TEST_SOURCE_SHA !== commit ||
    !/^refs\/heads\/diagnose\/[A-Za-z0-9._/-]+$/.test(
      env.CHAIN_DIAGNOSTIC_SOURCE_REF ?? "",
    ) ||
    !sha(env.CHAIN_DIAGNOSTIC_CLAIM) ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") ||
    env.GITHUB_RUN_ATTEMPT !== "1"
  )
    throw Error(
      "Diagnostic verified descendant source/governance context invalid.",
    );
  const expected = [
    env.CHAIN_DIAGNOSTIC_GOVERNANCE,
    commit,
    env.CHAIN_DIAGNOSTIC_SOURCE_REF,
    env.GITHUB_RUN_ID,
    "1",
    env.CHAIN_DIAGNOSTIC_CLAIM,
  ].join(":");
  if (env.CHAIN_DIAGNOSTIC_AUTHORIZATION !== expected)
    throw Error("Diagnostic parent-issued descendant authorization invalid.");
  return {
    eventPolicy: env.CHAIN_TEST_EVENT_POLICY,
    eventName: env.GITHUB_EVENT_NAME,
    eventRef: env.GITHUB_REF,
    governance: env.GITHUB_SHA,
    source: commit,
    sourceRef: env.CHAIN_DIAGNOSTIC_SOURCE_REF,
    claim: env.CHAIN_DIAGNOSTIC_CLAIM,
    runId: env.GITHUB_RUN_ID,
    runAttempt: 1,
    nonqualifying: true,
  };
}
export function assertDiagnosticRuntimeAllowed(repo, commit, input) {
  if (!diagnosticSource(repo, commit)) return null;
  if (!input)
    throw Error(
      "Diagnostic CI requires a signed admitted bundle before launching its runtime.",
    );
  if (
    process.env.CHAIN_TEST_EVENT_POLICY === "diagnostic-workflow-dispatch-v1"
  ) {
    const descendant = consumeDiagnosticChannel(
      diagnosticDescendantContext(process.env, commit),
      repo,
    );
    return {
      ...verifyDiagnosticSignedInputs(repo, commit, input, false),
      descendant,
    };
  }
  return verifyDiagnosticCI(repo, commit, input);
}

export function verifyDiagnosticCI(repo, commit, input) {
  return verifyDiagnosticSignedInputs(repo, commit, input, true);
}
function verifyDiagnosticSignedInputs(
  repo,
  commit,
  input,
  verifyAuthorityLive,
) {
  const marker = diagnosticSource(repo, commit);
  if (!marker)
    throw Error("Diagnostic CI requires its committed source manifest.");
  const bundle = JSON.parse(read(path.resolve(input))),
    body = JSON.stringify(bundle.body);
  if (
    !verify(
      null,
      Buffer.from(body),
      marker.publicKey,
      Buffer.from(bundle.signature ?? "", "base64"),
    )
  )
    throw Error("Diagnostic portable journal signature invalid.");
  const { state, attemptId } = bundle.body,
    attempt = state?.attempts?.find((a) => a.id === attemptId);
  if (
    !Number.isSafeInteger(state.allowance) ||
    state.allowance < 1 ||
    state.attempts.length > state.allowance ||
    state.status !== "open" ||
    state.attempts.at(-1)?.id !== attemptId ||
    state.attempts.slice(0, -1).some((a) => !a.consumed) ||
    state.task !== marker.task ||
    state.repository !== marker.repository ||
    (state.startingSourceIssueFingerprint ?? state.sourceIssue.fingerprint) !==
      marker.sourceIssueFingerprint ||
    !attempt ||
    attempt.consumed ||
    attempt.result ||
    attempt.source.commit !== commit ||
    state.source.commit !== commit ||
    state.source.tree !== git(repo, "rev-parse", `${commit}^{tree}`)
  )
    throw Error(
      "Diagnostic CI source/task/attempt authorization inconsistent.",
    );
  if (process.env.GITHUB_RUN_ATTEMPT && process.env.GITHUB_RUN_ATTEMPT !== "1")
    throw Error(
      "Diagnostic CI retry needs a newly admitted explicit authorized attempt.",
    );
  if (verifyAuthorityLive) verifyAuthority(repo, state, true);
  const actual = source(repo, state.source.base, state.sourcePaths);
  if (
    actual.commit !== commit ||
    actual.tree !== state.source.tree ||
    actual.inputFingerprint !== state.source.inputFingerprint
  )
    throw Error("Diagnostic CI actual inputs changed.");
  return {
    task: state.task,
    attempt: attempt.id,
    remaining: state.allowance - state.attempts.length,
    gate: state.gate,
    source: state.source,
  };
}
export async function progressCommand(operation, options) {
  const repo = path.resolve(options.repo);
  if (operation === "admit") {
    const plan = JSON.parse(read(path.resolve(options.input)));
    return admitDiagnosticAttempt(repo, {
      task: options.task,
      request: plan.request,
      command: plan.command,
      args: plan.args,
      resultPath: options.record,
    });
  }
  if (operation === "verify-ci")
    return verifyDiagnosticCI(
      repo,
      options.commit ?? git(repo, "rev-parse", "HEAD"),
      options.input,
    );
  return locked(repo, async (dir) => {
    if (operation === "prepare") {
      const task = Number(options.task);
      if (!Number.isSafeInteger(task) || task < 1)
        throw Error("Diagnostic task issue number required.");
      const auth = authority(repo, task),
        keys = generateKeyPairSync("ed25519"),
        keyPath = path.join(dir, "signing-key.pem");
      if (
        fs.existsSync(path.join(dir, "current.json")) ||
        fs.existsSync(keyPath) ||
        fs.existsSync(path.join(repo, MANIFEST))
      )
        throw Error(
          "Diagnostic manifest/key already exists; preserve the existing task identity.",
        );
      const privateKey = keys.privateKey.export({
          type: "pkcs8",
          format: "pem",
        }),
        publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
      const keyFd = fs.openSync(keyPath, "wx", 0o600);
      try {
        fs.writeFileSync(keyFd, privateKey);
        fs.fsyncSync(keyFd);
      } finally {
        fs.closeSync(keyFd);
      }
      const marker = {
        schemaVersion: 1,
        mode: "diagnostic-only",
        task,
        repository: auth.repository,
        sourceIssueFingerprint: auth.parent.fingerprint,
        publicKey,
      };
      immutable(path.join(repo, MANIFEST), marker);
      syncDir(dir);
      return {
        task,
        status: "commit-source-manifest",
        manifest: path.join(repo, MANIFEST),
        sourceIssue: {
          number: auth.parent.issue.number,
          fingerprint: auth.parent.fingerprint,
        },
      };
    }
    if (operation === "start") {
      if (
        fs.existsSync(path.join(dir, "current.json")) ||
        fs.readdirSync(dir).some((x) => /^revision-/.test(x))
      )
        throw Error(
          "Diagnostic task state already exists; a new context or branch cannot renew it.",
        );
      const task = Number(options.task);
      if (!Number.isSafeInteger(task) || task < 1)
        throw Error("Diagnostic task issue number required.");
      const auth = authority(repo, task),
        plan = JSON.parse(read(path.resolve(options.input)));
      const marker = manifestAt(repo, git(repo, "rev-parse", "HEAD"));
      if (
        !marker ||
        marker.task !== task ||
        marker.repository !== auth.repository ||
        marker.sourceIssueFingerprint !== auth.parent.fingerprint
      )
        throw Error(
          "Diagnostic current committed source manifest missing/stale; run prepare, inspect and commit it before starting.",
        );
      for (const key of [
        "gate",
        "nextAction",
        "owner",
        "allocation",
        "hypothesis",
      ])
        text(plan[key], key);
      if (
        !Number.isSafeInteger(plan.allowance) ||
        plan.allowance < 1 ||
        plan.allowance > 20
      )
        throw Error("Diagnostic allowance must be finite (1..20).");
      if (
        !Array.isArray(plan.sourcePaths) ||
        !plan.sourcePaths.length ||
        plan.sourcePaths.some(
          (p) =>
            typeof p !== "string" ||
            p.startsWith("/") ||
            p.includes("..") ||
            !git(repo, "ls-tree", "-r", "HEAD", "--", p),
        )
      )
        throw Error(
          "Diagnostic sourcePaths must identify existing tracked inputs.",
        );
      if (
        !Number.isInteger(plan.observation?.expectedExitCode) ||
        !plan.observation?.stdoutIncludes
      )
        throw Error(
          "Diagnostic distinguishing observation requires expectedExitCode and stdoutIncludes.",
        );
      if (
        !plan.launch ||
        typeof plan.launch.command !== "string" ||
        !Array.isArray(plan.launch.args) ||
        plan.launch.args.some((a) => typeof a !== "string")
      )
        throw Error("Diagnostic exact supported launch command/args required.");
      const state = {
        schemaVersion: 1,
        task,
        repository: auth.repository,
        repositoryIdentity: fs.realpathSync(
          git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"),
        ),
        taskIssue: auth.task,
        sourceIssue: auth.parent,
        startingSourceIssueFingerprint: auth.parent.fingerprint,
        source: source(repo, plan.base, plan.sourcePaths),
        ...Object.fromEntries(
          [
            "gate",
            "nextAction",
            "owner",
            "allocation",
            "hypothesis",
            "observation",
            "allowance",
            "sourcePaths",
            "entrypoints",
            "launch",
          ].map((k) => [k, plan[k]]),
        ),
        status: "open",
        attempts: [],
        events: [],
        createdAt: new Date().toISOString(),
      };
      save(dir, state);
      return summary(state);
    }
    const { state, head } = load(dir);
    if (options.task && Number(options.task) !== state.task)
      throw Error("Diagnostic task identity mismatch.");
    if (operation === "inspect")
      return { ...summary(state), journalDigest: head.digest };
    if (operation === "export" || operation === "export-public") {
      verifyAuthority(repo, state);
      verifySource(repo, state);
      const attempt = state.attempts.find((a) => a.id === options.attempt);
      if (!attempt || attempt.result || attempt.consumed)
        throw Error("Diagnostic export needs an admitted unfinished attempt.");
      const publicState = {
        task: state.task,
        repository: state.repository,
        owner: state.owner,
        source: state.source,
        sourcePaths: state.sourcePaths,
        gate: state.gate,
        status: state.status,
        allowance: state.allowance,
        taskIssue: { fingerprint: state.taskIssue.fingerprint },
        sourceIssue: { fingerprint: state.sourceIssue.fingerprint },
        startingSourceIssueFingerprint:
          state.startingSourceIssueFingerprint ?? state.sourceIssue.fingerprint,
        attempts: state.attempts.map((a) => ({
          id: a.id,
          source: a.source,
          consumed: a.consumed,
        })),
        events: state.events
          .filter((e) => e.type === "explicit-extension")
          .map((e) => ({
            type: e.type,
            approvalComment: e.approvalComment,
            approvedBy: e.approvedBy,
          })),
      };
      const body = {
        schemaVersion: 1,
        ...(operation === "export-public" ? { public: true } : {}),
        journalDigest: head.digest,
        state: operation === "export-public" ? publicState : state,
        attemptId: attempt.id,
      };
      const signature = sign(
        null,
        Buffer.from(JSON.stringify(body)),
        read(path.join(dir, "signing-key.pem")),
      ).toString("base64");
      immutable(path.resolve(options.record), { body, signature });
      return {
        task: state.task,
        attempt: attempt.id,
        record: path.resolve(options.record),
      };
    }
    if (operation === "extend") {
      const approvalPath = path.resolve(options.approval),
        raw = read(approvalPath),
        approval = JSON.parse(raw);
      if (
        approval.task !== state.task ||
        approval.repository !== state.repository ||
        approval.priorDigest !== head.digest ||
        approval.sourceCommit !== state.source.commit ||
        !Number.isSafeInteger(approval.additionalAttempts) ||
        approval.additionalAttempts < 1 ||
        approval.additionalAttempts > 20 ||
        approval.approvedBy === state.owner
      )
        throw Error(
          "Diagnostic extension requires explicit bounded independent approval for the exact current journal and source.",
        );
      text(approval.approvedBy, "approval authority");
      text(approval.reason, "approval reason");
      const evidence = approval.authorizationEvidence;
      if (
        !evidence ||
        digest(read(path.resolve(evidence.path))) !== evidence.sha256
      )
        throw Error(
          "Diagnostic approval needs immutable authorization evidence.",
        );
      const approvalComment = verifyApprovalComment(
        state.repository,
        approval,
        read(path.resolve(evidence.path)),
      );
      const currentAuthority = verifyAuthority(
        repo,
        state,
        false,
        approvalComment,
      );
      if (
        currentAuthority.task.fingerprint !== state.taskIssue.fingerprint ||
        currentAuthority.parent.fingerprint !== state.sourceIssue.fingerprint
      ) {
        state.events.push({
          type: "approved-authority-append",
          previousTaskIssue: state.taskIssue,
          previousSourceIssue: state.sourceIssue,
          approvalComment,
          at: new Date().toISOString(),
        });
        state.taskIssue = currentAuthority.task;
        state.sourceIssue = currentAuthority.parent;
      }
      state.allowance += approval.additionalAttempts;
      state.events.push({
        type: "explicit-extension",
        approvalComment,
        approval: { path: approvalPath, sha256: digest(raw) },
        authorizationEvidence: evidence,
        approvedBy: approval.approvedBy,
        additionalAttempts: approval.additionalAttempts,
        reason: approval.reason,
        at: new Date().toISOString(),
      });
      save(dir, state, head);
      return summary(state);
    }
    if (operation === "verify-publication") {
      assertDiagnosticPublicationAllowed(
        repo,
        options.commit ?? git(repo, "rev-parse", "HEAD"),
      );
      return summary(state);
    }
    if (operation === "consume") {
      verifyAuthority(repo, state);
      verifySource(repo, state);
      const attempt = state.attempts.find((a) => a.id === options.attempt);
      if (!attempt || !attempt.result)
        throw Error("Diagnostic actual terminal attempt result required.");
      if (attempt.consumed) return summary(state);
      const raw = read(attempt.result.path);
      if (digest(raw) !== attempt.result.sha256)
        throw Error("Diagnostic immutable result fingerprint changed.");
      const record = JSON.parse(raw);
      if (
        record.git?.commit !== attempt.source.commit ||
        record.state !== "complete" ||
        record.evidence?.status === "failed"
      )
        throw Error(
          "Diagnostic result actual source or completed evidence inconsistent.",
        );
      const observed = {
        exitCode: record.execution?.exitCode,
        stdoutMatch:
          record.execution?.output?.stdout?.includes(
            attempt.observation.stdoutIncludes,
          ) === true,
      };
      const passed =
        observed.exitCode === 0 &&
        observed.exitCode === attempt.observation.expectedExitCode &&
        observed.stdoutMatch &&
        record.execution.signal === null;
      attempt.consumed = true;
      attempt.consumption = {
        observed,
        passed,
        at: new Date().toISOString(),
        source: attempt.source,
        result: { ...attempt.result },
      };
      if (passed) {
        state.status = "complete";
        state.nextAction = null;
      } else {
        state.status = "open";
        state.nextAction = `Required gate ${state.gate} failed: inspect immutable attempt ${attempt.id} and record the smallest material input change.`;
      }
      save(dir, state, head);
      return summary(state);
    }
    if (operation === "change-source") {
      verifyAuthority(repo, state);
      if (state.attempts.some((a) => !a.consumed))
        throw Error(
          "Diagnostic result must be consumed before changing source.",
        );
      const actual = source(repo, state.source.base, state.sourcePaths);
      if (actual.inputFingerprint === state.source.inputFingerprint)
        throw Error(
          "Diagnostic material tracked input change required; observer commits and wording do not renew probes.",
        );
      const plan = JSON.parse(read(path.resolve(options.input)));
      text(plan.hypothesis, "predeclared hypothesis");
      text(plan.nextAction, "single next action");
      if (
        !Number.isInteger(plan.observation?.expectedExitCode) ||
        !plan.observation?.stdoutIncludes
      )
        throw Error("Diagnostic distinguishing observation required.");
      state.events.push({
        type: "source-change",
        previous: state.source,
        current: actual,
        at: new Date().toISOString(),
      });
      state.source = actual;
      state.hypothesis = plan.hypothesis;
      state.observation = plan.observation;
      state.nextAction = plan.nextAction;
      state.status = "open";
      save(dir, state, head);
      return summary(state);
    }
    if (operation === "hold") {
      text(options.reason, "actual blocker or explicit user hold reason");
      state.status = "held";
      state.events.push({
        type: "hold",
        reason: options.reason,
        at: new Date().toISOString(),
      });
      save(dir, state, head);
      return summary(state);
    }
    throw Error(`Unsupported diagnostic operation ${operation}.`);
  });
}
export function assertDiagnosticPublicationAllowed(repo, commit) {
  const marker = diagnosticSource(repo, commit);
  if (marker) {
    const dir = diagnosticDirectory(repo);
    if (fs.existsSync(path.join(dir, "current.json"))) {
      const { state } = load(dir);
      if (
        state.task !== marker.task ||
        state.status !== "complete" ||
        state.attempts.some((a) => !a.consumed)
      )
        throw Error(
          `Diagnostic required gate ${state.gate} incomplete; missing evidence: consumed passing observation. Next: ${state.nextAction}`,
        );
    }
    throw Error(
      `Diagnostic-only source for task #${marker.task} cannot receive product completion/release receipts; verify diagnostic CI authorization separately.`,
    );
  }
  const dir = diagnosticDirectory(repo);
  if (!fs.existsSync(path.join(dir, "current.json"))) {
    if (process.env.CHAIN_DIAGNOSTIC_TASK)
      throw Error("Diagnostic durable state missing; publication refused.");
    return;
  }
  const { state } = load(dir);
  if (state.source.commit !== commit && !process.env.CHAIN_DIAGNOSTIC_TASK)
    return;
  if (
    state.status !== "complete" ||
    state.attempts.some((a) => !a.consumed) ||
    state.source.commit !== commit
  )
    throw Error(
      `Diagnostic required gate ${state.gate} incomplete; missing evidence: consumed passing observation. Next: ${state.nextAction}`,
    );
  verifyAuthority(repo, state);
}

export async function admitDiagnosticAttempt(
  repo,
  { task, request, command, args, resultPath },
) {
  if (!assertDiagnosticLaunchAllowed(repo, { task, command, args }))
    return null;
  return locked(repo, (dir) => {
    const { state, head } = load(dir);
    verifyAuthority(repo, state);
    verifySource(repo, state);
    if (
      command !== state.launch.command ||
      JSON.stringify(args) !== JSON.stringify(state.launch.args)
    )
      throw Error(
        "Diagnostic launch command differs from its predeclared supported command.",
      );
    const inputs = digest({
      inputFingerprint: state.source.inputFingerprint,
      command,
      args,
    });
    const requestId = request ?? inputs,
      existing = state.attempts.find((a) => a.request === requestId);
    if (existing) {
      if (existing.inputs !== inputs)
        throw Error("Diagnostic request identity reused for different inputs.");
      return {
        observed: true,
        attempt: existing,
        remaining: state.allowance - state.attempts.length,
      };
    }
    if (state.status !== "open")
      throw Error(
        `Diagnostic gate ${state.gate} is ${state.status}; next: ${state.nextAction}`,
      );
    if (state.attempts.some((a) => !a.consumed))
      throw Error(
        "Diagnostic prior result must be consumed against independent observations before another probe.",
      );
    if (state.attempts.length >= state.allowance)
      throw Error(
        `Diagnostic allowance exhausted; required gate ${state.gate} unresolved. Missing: passing observation. Next: ${state.nextAction}`,
      );
    if (state.attempts.some((a) => a.inputs === inputs))
      throw Error(
        "Diagnostic identical failed inputs cannot earn another regression; record a material source change or explicit authorized retry.",
      );
    const attempt = {
      id: randomUUID(),
      request: requestId,
      inputs,
      source: { ...state.source },
      hypothesis: state.hypothesis,
      observation: state.observation,
      resultPath: path.resolve(resultPath),
      admittedAt: new Date().toISOString(),
      owner: state.owner,
      allocation: state.allocation,
      consumed: false,
    };
    state.attempts.push(attempt);
    save(dir, state, head);
    return {
      observed: false,
      attempt,
      remaining: state.allowance - state.attempts.length,
    };
  });
}
export async function finishDiagnosticAttempt(repo, admission) {
  if (!admission || admission.observed) return;
  return locked(repo, (dir) => {
    const { state, head } = load(dir),
      attempt = state.attempts.find((a) => a.id === admission.attempt.id);
    if (!attempt || attempt.result)
      throw Error("Diagnostic attempt result already recorded or missing.");
    const raw = read(attempt.resultPath),
      record = JSON.parse(raw);
    if (record.state !== "complete" && record.state !== "incomplete")
      throw Error("Diagnostic result did not reach a terminal state.");
    attempt.result = { path: attempt.resultPath, sha256: digest(raw) };
    save(dir, state, head);
  });
}

// Only the independently verified hosted terminal consumer calls this seam.
// The local journal retains the same predeclared result path and allowance.
export async function recordDiagnosticCIResult(repo, attemptId, record) {
  return locked(repo, (dir) => {
    const { state, head } = load(dir);
    verifyAuthority(repo, state);
    verifySource(repo, state);
    const attempt = state.attempts.find((a) => a.id === attemptId);
    if (
      !attempt ||
      attempt.result ||
      attempt.consumed ||
      record.git?.commit !== attempt.source.commit ||
      record.state !== "complete" ||
      record.kind !== "nonqualifying-diagnostic-ci-result"
    )
      throw Error(
        "Diagnostic hosted terminal result is missing, stale or already recorded.",
      );
    immutable(attempt.resultPath, record);
    attempt.result = {
      path: attempt.resultPath,
      sha256: digest(read(attempt.resultPath)),
    };
    save(dir, state, head);
  });
}
