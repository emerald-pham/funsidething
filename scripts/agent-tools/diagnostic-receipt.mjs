// Diagnostic eligibility is an exact reviewed content envelope. It does not
// infer harmlessness from filenames, comments, caller labels, or review claims.
import fs from "node:fs";
import path from "node:path";
import { createHash, sign, verify } from "node:crypto";
import {
  diagnosticDirectory,
  verifyDiagnosticCI,
  progressCommand,
  recordDiagnosticCIResult,
} from "./checkpoint-progress.mjs";
import {
  verifyReleaseEvidence,
  verifyReleaseEvidenceDirectory,
} from "../release-evidence.mjs";
import { execute as executeRecordedCommand } from "./record-run.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const toolRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const FROZEN = "b176026825e4f9539780f745fe60e09cf348d288";
const OBSERVER = "c899e5e983cd756152c1d0c8057ffe8455e80956";
const TEMPLATE = "webkit-stall-thread-v1";
const markerPath = ".diagnostic-task.json";
const governance = [
  "scripts/release-evidence.mjs",
  "scripts/agent-tools/diagnostic-receipt.mjs",
  "scripts/agent-tools/diagnostic-hosted-policy.mjs",
  "scripts/agent-tools/checkpoint-progress.mjs",
  "scripts/agent-tools/checkpoint.mjs",
  "scripts/agent-tools/record-run.mjs",
  ".github/workflows/data-safety.yml",
  ".github/workflows/diagnostic.yml",
];
const domains = ["memory-cloud-sync", "release-process", "security-deployment"];
const canonical = (value) => {
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
  return JSON.stringify(sorted(JSON.parse(JSON.stringify(value))));
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function git(repo, ...args) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error(`Diagnostic Git inspection failed: ${result.stderr}`);
  return result.stdout.trim();
}
function inventory(repo, sha) {
  return new Map(
    git(repo, "ls-tree", "-r", sha)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [entry, file] = line.split("\t");
        return [file, entry];
      }),
  );
}
function blob(repo, sha, file) {
  const result = spawnSync("git", ["-C", repo, "show", `${sha}:${file}`], {
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error(`Diagnostic source object unavailable: ${file}`);
  return result.stdout;
}
function entry(bytes) {
  return (
    "100644 blob " +
    createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
      .digest("hex")
  );
}
function guardedMobile(repo) {
  return blob(repo, OBSERVER, "scripts/button-safety-mobile-memory.mjs")
    .toString()
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
    );
}
export function deriveDiagnosticImpact(repo, source, frozen) {
  if (frozen !== FROZEN)
    throw Error(
      "Unknown frozen diagnostic source; ordinary qualification remains required.",
    );
  const candidate = inventory(repo, source),
    canonical = inventory(repo, OBSERVER),
    original = inventory(repo, FROZEN);
  let ready = true;
  const changes = [];
  for (const [file, actual] of candidate) {
    if (file === markerPath) {
      const m = JSON.parse(blob(repo, source, file));
      if (
        m.mode !== "diagnostic-only" ||
        m.schemaVersion !== 1 ||
        !Number.isInteger(m.task) ||
        typeof m.publicKey !== "string"
      )
        throw Error("Diagnostic source manifest invalid.");
      continue;
    }
    if (
      governance.includes(file) &&
      fs.existsSync(path.join(toolRoot, file)) &&
      actual === entry(fs.readFileSync(path.join(toolRoot, file)))
    )
      continue;
    if (
      file === "scripts/button-safety-mobile-memory.mjs" &&
      actual === entry(Buffer.from(guardedMobile(repo)))
    )
      continue;
    if (actual !== canonical.get(file))
      throw Error(
        `Diagnostic frozen inventory or unknown instrumentation changed: ${file}`,
      );
  }
  for (const file of canonical.keys())
    if (!candidate.has(file))
      throw Error(`Diagnostic frozen input removed: ${file}`);
  for (const file of governance)
    if (
      !candidate.has(file) ||
      !fs.existsSync(path.join(toolRoot, file)) ||
      candidate.get(file) !== entry(fs.readFileSync(path.join(toolRoot, file)))
    )
      ready = false;
  if (
    candidate.get("scripts/button-safety-mobile-memory.mjs") !==
    entry(Buffer.from(guardedMobile(repo)))
  )
    ready = false;
  const frozenRows = [...original]
    .filter(
      ([file, value]) =>
        canonical.get(file) === value && !governance.includes(file),
    )
    .sort();
  for (const [file, value] of original)
    if (candidate.get(file) !== value) changes.push(file);
  return {
    schemaVersion: 1,
    kind: "nonqualifying-diagnostic-plan",
    eligible: true,
    template: TEMPLATE,
    source,
    sourceTree: git(repo, "rev-parse", `${source}^{tree}`),
    frozen: FROZEN,
    frozenTree: git(repo, "rev-parse", `${FROZEN}^{tree}`),
    frozenInventorySha256: hash(JSON.stringify(frozenRows)),
    frozenPathCount: frozenRows.length,
    changedInputs: changes.sort(),
    requiredDomains: domains,
    governanceReady: ready,
    templateInventorySha256: hash(JSON.stringify([...canonical].sort())),
    toolingSha256: hash(
      JSON.stringify(
        governance.map((file) => [
          file,
          fs.existsSync(path.join(toolRoot, file))
            ? hash(fs.readFileSync(path.join(toolRoot, file)))
            : null,
        ]),
      ),
    ),
  };
}
function readEvidence(repo, file, digest) {
  const actual = fs.realpathSync(file),
    root = fs.realpathSync(repo),
    stat = fs.lstatSync(file);
  if (
    actual === root ||
    actual.startsWith(root + path.sep) ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 32 * 1024 * 1024
  )
    throw Error(
      "Diagnostic evidence must be a bounded regular artifact outside the checkout.",
    );
  if (/\.(?:pem|key|p12|pfx)$/i.test(actual))
    throw Error("Private signing material cannot become diagnostic evidence.");
  const bytes = fs.readFileSync(actual);
  if (bytes.toString("utf8").includes("BEGIN PRIVATE KEY"))
    throw Error("Private signing material cannot become diagnostic evidence.");
  if (hash(bytes) !== digest)
    throw Error("Diagnostic inherited/review evidence fingerprint changed.");
  return bytes;
}
function receiptPath(repo, source) {
  return path.join(
    git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    "funsidething-diagnostic-evidence",
    source,
    "receipt.json",
  );
}
function evidenceFiles(frozenPath) {
  const files = {};
  for (const name of fs.readdirSync(path.dirname(frozenPath))) {
    if (!/^[a-z0-9.-]+$/.test(name))
      throw Error("Unknown inherited review artifact.");
    files["frozen/" + name] = fs
      .readFileSync(path.join(path.dirname(frozenPath), name))
      .toString("base64");
  }
  return files;
}
function validateReview(repo, review, source, label, files) {
  if (
    !review ||
    typeof review.task !== "string" ||
    review.task.trim().length < 3 ||
    review.outcome !== "approved" ||
    review.reviewedSha !== source
  )
    throw Error(
      `Diagnostic ${label} needs an exact-source independent review.`,
    );
  if (
    label === "specialist" &&
    JSON.stringify([...(review.domains ?? [])].sort()) !==
      JSON.stringify(domains)
  )
    throw Error(
      "Diagnostic unknown or missing affected instrumentation risks.",
    );
  const bytes = readEvidence(repo, review.evidencePath, review.sha256);
  files[label + ".txt"] = bytes.toString("base64");
  return {
    task: review.task,
    reviewedSha: source,
    outcome: "approved",
    sha256: hash(bytes),
    domains: label === "specialist" ? domains : undefined,
  };
}
function signReceipt(repo, body) {
  const privateKey = fs.readFileSync(
    path.join(diagnosticDirectory(repo), "signing-key.pem"),
  );
  return {
    body,
    signature: sign(null, Buffer.from(canonical(body)), privateKey).toString(
      "base64",
    ),
  };
}
function frozenEvidence(repo, input, impact, files) {
  if (input.reviewedSha !== FROZEN)
    throw Error(
      "Diagnostic inheritance must name the fixed reviewed frozen source.",
    );
  const prior = verifyReleaseEvidence(repo, FROZEN);
  if (
    !prior.ok ||
    prior.receipt?.schemaVersion !== 2 ||
    !prior.receipt.faqReview ||
    prior.receipt.policyInheritance ||
    prior.receipt.receiptSha256 !== input.receiptSha256
  )
    throw Error(
      "Diagnostic inherited full product/FAQ review is missing or invalid: " +
        prior.errors.join(" "),
    );
  Object.assign(files, evidenceFiles(prior.receiptPath));
  const renderedBytes = readEvidence(
      repo,
      input.renderedEvidencePath,
      input.renderedEvidenceSha256,
    ),
    rendered = JSON.parse(renderedBytes);
  if (
    rendered.schemaVersion !== 1 ||
    rendered.reviewedSha !== FROZEN ||
    rendered.treeSha !== impact.frozenTree ||
    rendered.outcome !== "approved" ||
    typeof rendered.task !== "string" ||
    rendered.task.toLowerCase() ===
      prior.receipt.ownerReview.task.toLowerCase() ||
    !rendered.artifacts?.length
  )
    throw Error(
      "Diagnostic inherited rendered approval is stale or not independent.",
    );
  files["rendered.json"] = renderedBytes.toString("base64");
  for (let i = 0; i < rendered.artifacts.length; i++) {
    const artifact = rendered.artifacts[i];
    files[`rendered-${i}`] = readEvidence(
      repo,
      artifact.evidencePath,
      artifact.sha256,
    ).toString("base64");
  }
  return {
    reviewedSha: FROZEN,
    receiptSha256: input.receiptSha256,
    faqSha256: prior.receipt.faqReview.evidence.sha256,
    renderedSha256: hash(renderedBytes),
  };
}
export function recordDiagnosticReceipt(repo, input) {
  if (input.kind !== "nonqualifying-diagnostic" || input.schemaVersion !== 1)
    throw Error("Explicit nonqualifying diagnostic input required.");
  const source = input.candidate?.commitSha,
    impact = deriveDiagnosticImpact(repo, source, input.frozen?.reviewedSha);
  if (
    !impact.governanceReady ||
    input.candidate.treeSha !== impact.sourceTree ||
    git(repo, "merge-base", source, input.candidate.baseSha) !==
      input.candidate.baseSha
  )
    throw Error(
      "Diagnostic trusted governance/source/base/tree missing or inconsistent.",
    );
  const admissionBytes = readEvidence(
      repo,
      input.admissionPath,
      input.admissionSha256,
    ),
    admission = JSON.parse(admissionBytes),
    authorized = verifyDiagnosticCI(repo, source, input.admissionPath),
    state = admission.body.state,
    ordinal = state.attempts.findIndex((a) => a.id === authorized.attempt) + 1;
  if (admission.body.public !== true)
    throw Error(
      "Diagnostic publication requires the minimal public execution permit, not a private journal export.",
    );
  if (
    state.owner !== input.owner ||
    ordinal < 1 ||
    state.attempts.length > state.allowance ||
    state.status !== "open"
  )
    throw Error(
      "Diagnostic finite durable authorization is missing or inconsistent.",
    );
  const files = { "admission.json": admissionBytes.toString("base64") },
    inheritance = frozenEvidence(repo, input.frozen, impact, files),
    code = validateReview(
      repo,
      input.independentReview,
      source,
      "independent",
      files,
    ),
    risk = validateReview(
      repo,
      input.specialistReview,
      source,
      "specialist",
      files,
    );
  if (
    new Set(
      [input.owner, code.task, risk.task].map((v) => String(v).toLowerCase()),
    ).size !== 3
  )
    throw Error(
      "Diagnostic owner, code and risk reviewers must be independent.",
    );
  if (
    !/^refs\/heads\/diagnose\/[a-zA-Z0-9._/-]+$/.test(
      input.outgoing?.remoteRef ?? "",
    ) ||
    input.outgoing.localRef !== input.outgoing.remoteRef ||
    !/^[a-f0-9]{40}$/.test(input.outgoing.remoteBefore ?? "")
  )
    throw Error(
      "Diagnostic outgoing authority must name one exact diagnostic ref and prior SHA.",
    );
  const body = {
    schemaVersion: 1,
    kind: "nonqualifying-diagnostic",
    candidate: input.candidate,
    impact,
    repository: state.repository,
    task: state.task,
    ordinal,
    attempt: authorized.attempt,
    requiredGate: state.gate,
    nextAction: state.nextAction,
    authorization: {
      admissionSha256: hash(admissionBytes),
      journalDigest: admission.body.journalDigest,
      remaining: authorized.remaining,
    },
    inheritance,
    owner: input.owner,
    independentReview: code,
    specialistReview: risk,
    outgoing: input.outgoing,
    files,
    fileSha256: Object.fromEntries(
      Object.entries(files).map(([name, data]) => [
        name,
        hash(Buffer.from(data, "base64")),
      ]),
    ),
    createdAt: new Date().toISOString(),
  };
  const receipt = signReceipt(repo, body),
    target = receiptPath(repo, source);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, JSON.stringify(receipt) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return {
    recorded: true,
    kind: body.kind,
    source,
    receiptPath: target,
    receiptSha256: hash(canonical(receipt)),
    task: body.task,
    ordinal,
    attempt: body.attempt,
    remaining: authorized.remaining,
  };
}
function validatePortableReceipt(repo, receipt, source) {
  const body = receipt.body,
    marker = JSON.parse(blob(repo, source, markerPath));
  if (
    !verify(
      null,
      Buffer.from(canonical(body)),
      marker.publicKey,
      Buffer.from(receipt.signature ?? "", "base64"),
    ) ||
    body.kind !== "nonqualifying-diagnostic" ||
    body.schemaVersion !== 1 ||
    body.candidate.commitSha !== source ||
    body.candidate.treeSha !== git(repo, "rev-parse", source + "^{tree}") ||
    body.task !== marker.task
  )
    throw Error("Diagnostic receipt signature/source/kind identity invalid.");
  const impact = deriveDiagnosticImpact(repo, source, FROZEN);
  if (!impact.governanceReady || canonical(body.impact) !== canonical(impact))
    throw Error(
      "Diagnostic receipt exact instrumentation/frozen inventory changed.",
    );
  for (const [name, data] of Object.entries(body.files)) {
    if (hash(Buffer.from(data, "base64")) !== body.fileSha256[name])
      throw Error(
        "Diagnostic portable inherited/review artifact fingerprint changed.",
      );
  }
  const rendered = JSON.parse(
    Buffer.from(body.files["rendered.json"], "base64"),
  );
  if (
    hash(Buffer.from(body.files["rendered.json"], "base64")) !==
      body.inheritance.renderedSha256 ||
    rendered.reviewedSha !== FROZEN ||
    rendered.treeSha !== impact.frozenTree
  )
    throw Error("Diagnostic rendered identity inconsistent.");
  for (let i = 0; i < rendered.artifacts.length; i++)
    if (
      hash(Buffer.from(body.files[`rendered-${i}`], "base64")) !==
      rendered.artifacts[i].sha256
    )
      throw Error("Diagnostic rendered artifact changed.");
  const temp = fs.mkdtempSync(
    path.join(path.dirname(diagnosticDirectory(repo)), "diagnostic-portable-"),
  );
  try {
    const inheritedDirectory = path.join(temp, "frozen");
    fs.mkdirSync(inheritedDirectory);
    for (const [name, data] of Object.entries(body.files))
      if (name.startsWith("frozen/")) {
        const leaf = name.slice(7);
        if (!/^[a-z0-9.-]+$/.test(leaf))
          throw Error("Diagnostic inherited artifact name unsafe.");
        fs.writeFileSync(
          path.join(inheritedDirectory, leaf),
          Buffer.from(data, "base64"),
          { flag: "wx" },
        );
      }
    const inherited = verifyReleaseEvidenceDirectory(
      repo,
      FROZEN,
      inheritedDirectory,
    );
    if (
      !inherited.ok ||
      inherited.receipt?.schemaVersion !== 2 ||
      !inherited.receipt.faqReview ||
      inherited.receipt.policyInheritance ||
      inherited.receipt.receiptSha256 !== body.inheritance.receiptSha256 ||
      inherited.receipt.faqReview.evidence.sha256 !== body.inheritance.faqSha256
    )
      throw Error(
        "Diagnostic inherited full product/FAQ review invalid: " +
          inherited.errors.join(" "),
      );
    if (
      body.inheritance.reviewedSha !== FROZEN ||
      rendered.schemaVersion !== 1 ||
      rendered.outcome !== "approved" ||
      typeof rendered.task !== "string" ||
      rendered.task.toLowerCase() ===
        inherited.receipt.ownerReview.task.toLowerCase() ||
      !rendered.artifacts?.length
    )
      throw Error("Diagnostic inherited rendered approval invalid.");
    const identities = [
      body.owner,
      body.independentReview?.task,
      body.specialistReview?.task,
    ];
    if (
      identities.some((v) => typeof v !== "string" || v.trim().length < 3) ||
      new Set(identities.map((v) => v.toLowerCase())).size !== 3
    )
      throw Error("Diagnostic source reviews are not independent.");
    for (const [label, review] of [
      ["independent", body.independentReview],
      ["specialist", body.specialistReview],
    ])
      if (
        review.reviewedSha !== source ||
        review.outcome !== "approved" ||
        hash(Buffer.from(body.files[label + ".txt"] ?? "", "base64")) !==
          review.sha256
      )
        throw Error("Diagnostic source review bytes or identity invalid.");
    if (canonical(body.specialistReview.domains) !== canonical(domains))
      throw Error("Diagnostic affected instrumentation risks invalid.");
    const admission = path.join(temp, "admission.json");
    fs.writeFileSync(
      admission,
      Buffer.from(body.files["admission.json"], "base64"),
    );
    const result = verifyDiagnosticCI(repo, source, admission);
    if (result.task !== body.task || result.attempt !== body.attempt)
      throw Error("Diagnostic attempt identity inconsistent.");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return body;
}
export function verifyDiagnosticReceipt(repo, source) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath(repo, source)));
  return {
    receipt,
    body: validatePortableReceipt(repo, receipt, source),
    receiptSha256: hash(canonical(receipt)),
  };
}
export function verifyDiagnosticOutgoing(repo, source, update) {
  const exists =
    spawnSync("git", ["-C", repo, "cat-file", "-e", source + ":" + markerPath])
      .status === 0;
  if (!exists) return false;
  const { body } = verifyDiagnosticReceipt(repo, source);
  if (
    git(repo, "rev-parse", "HEAD") !== source ||
    body.outgoing.localRef !== update.localRef ||
    body.outgoing.remoteRef !== update.remoteRef ||
    body.outgoing.remoteBefore !== update.remoteSha ||
    update.localSha !== source ||
    !/^refs\/heads\/diagnose\//.test(update.remoteRef)
  )
    throw Error(
      "Diagnostic outgoing update does not match its exact admitted source/ref/prior SHA.",
    );
  return true;
}
function gh(repository, endpoint, method = "GET", input) {
  const args = [
      "api",
      "repos/" + repository + endpoint,
      "--method",
      method,
      ...(input === undefined ? [] : ["--input", "-"]),
    ],
    r = spawnSync("gh", args, {
      encoding: "utf8",
      input: input === undefined ? undefined : JSON.stringify(input),
      timeout: 15000,
      maxBuffer: 48 * 1024 * 1024,
    });
  if (r.status !== 0) {
    const error = Error(
      `Diagnostic GitHub ${method} failed: ${r.stderr || r.error?.message}`,
    );
    error.notFound = /HTTP 404/.test(r.stderr ?? "");
    error.conflict = /HTTP 422/.test(r.stderr ?? "");
    throw error;
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    return r.stdout;
  }
}
function readRef(repository, ref) {
  try {
    const value = gh(repository, "/git/ref/" + ref.slice(5));
    if (!/^[a-f0-9]{40}$/.test(value.object?.sha ?? ""))
      throw Error("Diagnostic remote ref identity invalid.");
    return value.object.sha;
  } catch (error) {
    if (error.notFound) return null;
    throw error;
  }
}
function reserve(repository, ref, source) {
  try {
    gh(repository, "/git/refs", "POST", { ref, sha: source });
    return true;
  } catch (error) {
    if (!error.conflict) throw error;
    const existing = readRef(repository, ref);
    if (existing !== source)
      throw Error(
        "Diagnostic canonical reservation belongs to different source; no publication permitted.",
      );
    return false;
  }
}
function namespace(body) {
  return `refs/tags/chain-diagnostics/task-${body.task}/attempt-${body.ordinal}`;
}
function writeGraph(repository, payload, files, source, createdAt) {
  const tree = [];
  for (const [name, bytes] of Object.entries({
    "permit.json": Buffer.from(canonical(payload)),
    ...Object.fromEntries(
      Object.entries(files).map(([name, data]) => [
        "proof/" + name,
        Buffer.from(data, "base64"),
      ]),
    ),
  })) {
    const blob = gh(repository, "/git/blobs", "POST", {
      content: bytes.toString("base64"),
      encoding: "base64",
    });
    tree.push({ path: name, mode: "100644", type: "blob", sha: blob.sha });
  }
  const result = gh(repository, "/git/trees", "POST", { tree });
  return gh(repository, "/git/commits", "POST", {
    message: "Nonqualifying diagnostic authority; never product approval",
    tree: result.sha,
    parents: [source],
    author: {
      name: "Diagnostic authority",
      email: "diagnostic@example.invalid",
      date: createdAt,
    },
    committer: {
      name: "Diagnostic authority",
      email: "diagnostic@example.invalid",
      date: createdAt,
    },
  }).sha;
}
function readGraph(repository, object) {
  const commit = gh(repository, "/git/commits/" + object),
    tree = gh(repository, "/git/trees/" + (commit.tree.sha ?? commit.tree));
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 32)
    throw Error("Diagnostic remote artifact tree incomplete.");
  const files = {};
  let payload;
  for (const row of tree.tree) {
    if (
      row.type !== "blob" ||
      row.mode !== "100644" ||
      typeof row.path !== "string" ||
      row.path.includes("..") ||
      row.path.startsWith("/")
    )
      throw Error("Diagnostic artifact tree has unsafe entries.");
    const value = gh(repository, "/git/blobs/" + row.sha);
    if (value.encoding !== "base64" || typeof value.content !== "string")
      throw Error("Diagnostic remote artifact bytes unavailable.");
    const bytes = Buffer.from(value.content.replace(/\s/g, ""), "base64");
    if (bytes.length > 32 * 1024 * 1024)
      throw Error("Diagnostic artifact exceeds bound.");
    if (row.path === "permit.json") payload = JSON.parse(bytes);
    else if (row.path.startsWith("proof/"))
      files[row.path.slice(6)] = bytes.toString("base64");
    else throw Error("Diagnostic unexpected artifact entry.");
  }
  if (!payload) throw Error("Diagnostic remote permit metadata missing.");
  return { payload, files };
}
function validatePublishedPermit(
  repo,
  repository,
  ref,
  object,
  expectedSource,
) {
  if (
    !/^refs\/tags\/chain-diagnostics\/task-\d+\/attempt-\d+\/permit$/.test(
      ref,
    ) ||
    readRef(repository, ref) !== object
  )
    throw Error("Diagnostic permit ref/object identity mismatch.");
  const graph = readGraph(repository, object),
    receipt = graph.payload.receipt;
  if (!receipt || graph.payload.kind !== "nonqualifying-diagnostic-permit")
    throw Error("Diagnostic permit kind invalid.");
  receipt.body.files = graph.files;
  const body = validatePortableReceipt(repo, receipt, expectedSource);
  if (
    namespace(body) + "/permit" !== ref ||
    hash(canonical(receipt)) !== graph.payload.receiptSha256
  )
    throw Error("Diagnostic immutable permit binding inconsistent.");
  return { body, receipt, receiptSha256: graph.payload.receiptSha256 };
}
export function launchDiagnostic(repo, source) {
  const checked = verifyDiagnosticReceipt(repo, source),
    { body, receipt, receiptSha256 } = checked,
    repository = body.repository,
    base = namespace(body),
    reservation = base + "/reservation",
    permit = base + "/permit";
  const bytes = Buffer.byteLength(canonical(receipt));
  if (bytes > 32 * 1024 * 1024 || Object.keys(body.files).length > 30)
    throw Error(
      "Diagnostic selected artifact bundle exceeds publication bound.",
    );
  const previous = readRef(repository, reservation),
    existing = readRef(repository, permit);
  if ((previous && previous !== source) || (existing && !previous))
    throw Error(
      "Diagnostic existing reservation/permit source is inconsistent.",
    );
  if (previous) {
    if (existing) {
      const observed = validatePublishedPermit(
        repo,
        repository,
        permit,
        existing,
        source,
      );
      if (observed.receiptSha256 !== receiptSha256)
        throw Error(
          "Diagnostic existing permit belongs to a different immutable receipt.",
        );
      return {
        observed: true,
        outcome: "permit-already-reserved",
        permit,
        permitObject: existing,
        task: body.task,
        ordinal: body.ordinal,
      };
    }
    return {
      observed: true,
      outcome: "reserved-unresolved",
      reservation,
      task: body.task,
      ordinal: body.ordinal,
      nextAction:
        "Inspect the original reservation and dispatch evidence; never automatically redispatch or renew.",
    };
  }
  const remote = gh(repository, "/commits/" + source);
  if (
    remote.sha !== source ||
    remote.commit?.tree?.sha !== body.candidate.treeSha
  )
    throw Error("Diagnostic actual remote source/tree is unavailable.");
  if (!reserve(repository, reservation, source)) {
    return {
      observed: true,
      outcome: "reserved-unresolved",
      reservation,
      task: body.task,
      ordinal: body.ordinal,
    };
  }
  const portable = JSON.parse(JSON.stringify(receipt));
  delete portable.body.files;
  const object = writeGraph(
    repository,
    {
      kind: "nonqualifying-diagnostic-permit",
      receiptSha256,
      receipt: portable,
    },
    body.files,
    source,
    body.createdAt,
  );
  gh(repository, "/git/refs", "POST", { ref: permit, sha: object });
  const dispatched = spawnSync(
    "gh",
    [
      "workflow",
      "run",
      "diagnostic.yml",
      "--repo",
      repository,
      "--ref",
      body.outgoing.remoteRef.slice("refs/heads/".length),
      "-f",
      "permit=" + permit,
      "-f",
      "permit-object=" + object,
      "-f",
      "source=" + source,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  if (dispatched.status !== 0)
    throw Error(
      "Diagnostic dispatch unresolved after immutable permit publication; observe original state, never auto-renew.",
    );
  return {
    observed: false,
    outcome: "dispatched-nonqualifying",
    permit,
    permitObject: object,
    task: body.task,
    ordinal: body.ordinal,
    attempt: body.attempt,
  };
}
export function claimDiagnostic(
  repo,
  permit,
  permitObject,
  source,
  runId,
  runAttempt,
  allowCreate = true,
) {
  if (
    !/^[1-9][0-9]*$/.test(runId ?? "") ||
    runAttempt !== "1" ||
    (process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ID !== runId) ||
    (process.env.GITHUB_RUN_ATTEMPT && process.env.GITHUB_RUN_ATTEMPT !== "1")
  )
    throw Error(
      "Diagnostic CI must bind one exact first workflow run attempt.",
    );
  if (
    git(repo, "rev-parse", "HEAD") !== source ||
    git(repo, "status", "--porcelain", "--untracked-files=no")
  )
    throw Error("Diagnostic CI actual checkout/source is stale or dirty.");
  const marker = JSON.parse(blob(repo, source, markerPath)),
    repository = marker.repository,
    checked = validatePublishedPermit(
      repo,
      repository,
      permit,
      permitObject,
      source,
    ),
    { body, receipt } = checked,
    base = namespace(body),
    reservation = base + "/claim-reservation",
    claimRef = base + "/claim",
    existing = readRef(repository, claimRef),
    reserved = readRef(repository, reservation);
  const run = gh(repository, "/actions/runs/" + runId);
  if (
    String(run.id) !== runId ||
    run.head_sha !== source ||
    run.head_branch !== body.outgoing.remoteRef.slice(11) ||
    run.run_attempt !== 1 ||
    run.event !== "workflow_dispatch" ||
    run.path !== ".github/workflows/diagnostic.yml" ||
    run.name !== "Nonqualifying source-bound diagnostic" ||
    !["queued", "in_progress", "completed"].includes(run.status) ||
    (process.env.GITHUB_REPOSITORY &&
      process.env.GITHUB_REPOSITORY !== repository) ||
    (process.env.GITHUB_EVENT_NAME &&
      process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") ||
    (process.env.GITHUB_REF &&
      process.env.GITHUB_REF !== body.outgoing.remoteRef)
  )
    throw Error(
      "Diagnostic actual GitHub run/source/workflow identity is inconsistent.",
    );
  if (existing) {
    const graph = readGraph(repository, existing),
      claim = graph.payload;
    if (
      claim.kind !== "nonqualifying-diagnostic-claim" ||
      claim.runId !== runId ||
      claim.runAttempt !== 1 ||
      claim.source !== source ||
      claim.permitObject !== permitObject ||
      claim.permit !== permit
    )
      throw Error(
        "Diagnostic canonical attempt was claimed by a different run/source.",
      );
    return {
      claimed: false,
      observed: true,
      outcome: "claim-already-observed",
      claimRef,
      claimObject: existing,
      permit,
      permitObject,
      source,
      runId,
      runAttempt: 1,
      body,
      receipt,
    };
  }
  if (reserved) {
    if (reserved !== permitObject)
      throw Error("Diagnostic claim reservation object mismatch.");
    return {
      claimed: false,
      observed: true,
      outcome: "claim-reserved-unresolved",
      claimRef,
      permit,
      permitObject,
      source,
      runId,
      runAttempt: 1,
    };
  }
  if (!allowCreate)
    throw Error(
      "Diagnostic runtime evidence already exists; only observation of an existing claim is allowed.",
    );
  if (!reserve(repository, reservation, permitObject))
    return {
      claimed: false,
      observed: true,
      outcome: "claim-reserved-unresolved",
      claimRef,
      permit,
      permitObject,
      source,
      runId,
      runAttempt: 1,
    };
  const claim = {
      schemaVersion: 1,
      kind: "nonqualifying-diagnostic-claim",
      task: body.task,
      ordinal: body.ordinal,
      attempt: body.attempt,
      permit,
      permitObject,
      source,
      sourceTree: body.candidate.treeSha,
      runId,
      runAttempt: 1,
    },
    object = writeGraph(repository, claim, {}, permitObject, body.createdAt);
  gh(repository, "/git/refs", "POST", { ref: claimRef, sha: object });
  return {
    claimed: true,
    observed: false,
    outcome: "claimed-nonqualifying",
    claimRef,
    claimObject: object,
    permit,
    permitObject,
    source,
    runId,
    runAttempt: 1,
    body,
    receipt,
  };
}
export async function runDiagnosticCI(
  repo,
  permit,
  permitObject,
  source,
  runId,
  runAttempt,
  outputPath,
) {
  const output = path.resolve(outputPath);
  if (output === repo || output.startsWith(path.resolve(repo) + path.sep))
    throw Error(
      "Diagnostic runtime evidence must be a new directory outside the checkout.",
    );
  const claimed = claimDiagnostic(
    repo,
    permit,
    permitObject,
    source,
    runId,
    runAttempt,
    !fs.existsSync(output) || fs.readdirSync(output).length === 0,
  );
  if (!claimed.claimed) return publicClaim(claimed);
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw Error(
      "Diagnostic runtime evidence directory already contains artifacts.",
    );
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const admissionPath = path.join(output, "public-admission.json");
  fs.writeFileSync(
    admissionPath,
    Buffer.from(claimed.body.files["admission.json"], "base64"),
    { flag: "wx", mode: 0o600 },
  );
  const env = {
    ...process.env,
    CI: "true",
    GITHUB_REPOSITORY: claimed.body.repository,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "workflow_dispatch",
    GITHUB_REF: process.env.GITHUB_REF || claimed.body.outgoing.remoteRef,
    CHAIN_TEST_SOURCE_SHA: source,
    CHAIN_TEST_EVENT_POLICY: "diagnostic-workflow-dispatch-v1",
    CHAIN_DIAGNOSTIC_BUNDLE: admissionPath,
    CHAIN_DIAGNOSTIC_CLAIM: claimed.claimObject,
    CHAIN_DIAGNOSTIC_SOURCE: source,
    CHAIN_DIAGNOSTIC_AUTHORIZATION: [
      source,
      runId,
      "1",
      claimed.claimObject,
    ].join(":"),
    CHAIN_DIAGNOSTIC_MOTION: "normal",
    CHAIN_DIAGNOSTIC_ACTIVATION: "baseline",
    CHAIN_DIAGNOSTIC_WORKLOAD: "full-app",
    CHAIN_DIAGNOSTIC_RASTER: "baseline",
  };
  process.stdout.write(
    `Diagnostic source ${source} tree ${claimed.body.candidate.treeSha} run ${runId} attempt 1 claim ${claimed.claimObject}\n`,
  );
  const startedAt = new Date().toISOString();
  let deadlineExceeded = false;
  const deadline = setTimeout(
    () => {
      deadlineExceeded = true;
      process.kill(process.pid, "SIGTERM");
    },
    14 * 60 * 1000,
  );
  deadline.unref();
  let result;
  try {
    result = await executeRecordedCommand(
      process.execPath,
      [
        "scripts/button-safety-mobile-memory.mjs",
        "--run",
        "--profile",
        "required-1gb",
        "--output-dir",
        path.join(output, "capped"),
      ],
      repo,
      { env },
    );
  } finally {
    clearTimeout(deadline);
  }
  const stdout = Buffer.from(result.stdout ?? ""),
    stderr = Buffer.from(result.stderr ?? "");
  fs.writeFileSync(path.join(output, "stdout.txt"), stdout, { flag: "wx" });
  fs.writeFileSync(path.join(output, "stderr.txt"), stderr, { flag: "wx" });
  // The current canonical template observes threads but does not prove native
  // attribution. A successful child remains an unpaid required gate until a
  // separately reviewed template supplies that actual distinguishing evidence.
  const reportPath = path.join(output, "capped", "report.json"),
    report = fs.existsSync(reportPath)
      ? {
          path: "capped/report.json",
          sha256: hash(fs.readFileSync(reportPath)),
        }
      : null;
  const terminal = {
    schemaVersion: 1,
    kind: "nonqualifying-diagnostic-terminal",
    source,
    sourceTree: claimed.body.candidate.treeSha,
    task: claimed.body.task,
    ordinal: claimed.body.ordinal,
    attempt: claimed.body.attempt,
    permit,
    permitObject,
    claimRef: claimed.claimRef,
    claimObject: claimed.claimObject,
    runId,
    runAttempt: 1,
    execution: {
      started: !result.launchError,
      exitCode: result.exitCode,
      signal: result.signal,
      interruption: result.interruption,
      deadlineExceeded,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdoutSha256: hash(stdout),
      stderrSha256: hash(stderr),
    },
    report,
    requiredGate: claimed.body.requiredGate,
    requiredGateStatus: "failed",
    missingEvidence:
      "Native attribution remains unproved by canonical webkit-stall-thread-v1.",
    productQualification: false,
  };
  fs.writeFileSync(
    path.join(output, "terminal.json"),
    JSON.stringify(terminal) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  process.exitCode = 1;
  return {
    outcome: "nonqualifying-failed-required-gate",
    terminal: path.join(output, "terminal.json"),
    requiredGate: terminal.requiredGate,
    missingEvidence: terminal.missingEvidence,
    productQualification: false,
  };
}
function binaryGH(repository, endpoint) {
  const result = spawnSync("gh", ["api", "repos/" + repository + endpoint], {
    timeout: 15000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error("Diagnostic remote artifact download failed.");
  return result.stdout;
}
function zipEntry(archive, name) {
  const result = spawnSync("unzip", ["-p", archive, name], {
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error("Diagnostic terminal archive entry unavailable: " + name);
  return result.stdout;
}
export async function consumeDiagnostic(repo, source, input) {
  const { body } = verifyDiagnosticReceipt(repo, source),
    repository = body.repository;
  const summaryBytes = readEvidence(
      repo,
      input.monitorSummaryPath,
      input.monitorSummarySha256,
    ),
    summary = JSON.parse(summaryBytes),
    runId = String(summary.runId);
  if (
    summary.repo !== repository ||
    summary.commit !== source ||
    summary.runAttempt !== 1 ||
    summary.status !== "completed" ||
    summary.logsState !== "saved" ||
    !summary.logs ||
    !/^[1-9][0-9]*$/.test(runId)
  )
    throw Error(
      "Diagnostic same-run monitor evidence incomplete or mismatched.",
    );
  const logsStat = fs.lstatSync(summary.logs);
  if (
    !logsStat.isFile() ||
    logsStat.isSymbolicLink() ||
    logsStat.nlink !== 1 ||
    logsStat.size > 32 * 1024 * 1024 ||
    path.dirname(path.resolve(summary.logs)) !==
      path.dirname(path.resolve(input.monitorSummaryPath))
  )
    throw Error("Diagnostic raw monitor logs unavailable.");
  const logs = fs.readFileSync(summary.logs),
    run = gh(repository, "/actions/runs/" + runId),
    jobsResponse = gh(repository, "/actions/runs/" + runId + "/jobs"),
    jobs = jobsResponse.jobs;
  if (
    String(run.id) !== runId ||
    run.head_sha !== source ||
    run.head_branch !== body.outgoing.remoteRef.slice(11) ||
    run.run_attempt !== 1 ||
    run.event !== "workflow_dispatch" ||
    run.path !== ".github/workflows/diagnostic.yml" ||
    run.name !== "Nonqualifying source-bound diagnostic" ||
    run.status !== "completed" ||
    !["success", "failure"].includes(run.conclusion) ||
    summary.conclusion !== run.conclusion
  )
    throw Error(
      "Diagnostic actual hosted run/source/workflow identity is inconsistent.",
    );
  if (
    jobs?.length !== 1 ||
    jobs[0].name !== "Nonqualifying diagnostic attempt" ||
    jobs[0].status !== "completed" ||
    !["success", "failure"].includes(jobs[0].conclusion)
  )
    throw Error("Diagnostic actual terminal job is missing or ambiguous.");
  const steps = jobs[0].steps ?? [],
    claimStep = steps.filter(
      (s) =>
        s.name === "Independently verify and atomically claim this attempt",
    ),
    upload = steps.filter(
      (s) =>
        s.name === "Retain diagnostic evidence without product qualification",
    );
  if (
    claimStep.length !== 1 ||
    !["success", "failure"].includes(claimStep[0].conclusion) ||
    upload.length !== 1 ||
    upload[0].conclusion !== "success"
  )
    throw Error(
      "Diagnostic claim or evidence upload did not execute completely.",
    );
  const base = namespace(body),
    permit = base + "/permit",
    permitObject = readRef(repository, permit),
    claimRef = base + "/claim",
    claimObject = readRef(repository, claimRef);
  if (!permitObject || !claimObject)
    throw Error("Diagnostic actual immutable claim missing.");
  const published = validatePublishedPermit(
      repo,
      repository,
      permit,
      permitObject,
      source,
    ),
    claim = readGraph(repository, claimObject).payload;
  if (
    published.body.attempt !== body.attempt ||
    claim.kind !== "nonqualifying-diagnostic-claim" ||
    claim.source !== source ||
    claim.sourceTree !== body.candidate.treeSha ||
    claim.runId !== runId ||
    claim.runAttempt !== 1 ||
    claim.attempt !== body.attempt ||
    claim.task !== body.task ||
    claim.ordinal !== body.ordinal ||
    claim.permit !== permit ||
    claim.permitObject !== permitObject
  )
    throw Error("Diagnostic terminal claim does not bind the actual run.");
  const header = `Diagnostic source ${source} tree ${body.candidate.treeSha} run ${runId} attempt 1 claim ${claimObject}`;
  if (!logs.toString("utf8").includes(header))
    throw Error(
      "Diagnostic raw monitor logs do not bind this exact source and claim.",
    );
  const artifactsResponse = gh(
      repository,
      "/actions/runs/" + runId + "/artifacts",
    ),
    artifacts = artifactsResponse.artifacts;
  if (artifacts?.length !== 1)
    throw Error("Diagnostic terminal artifact missing or ambiguous.");
  const artifact = artifacts[0];
  if (
    artifact.name !== `nonqualifying-diagnostic-${runId}-1` ||
    artifact.expired !== false ||
    artifact.workflow_run?.head_sha !== source ||
    !Number.isSafeInteger(artifact.id) ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "")
  )
    throw Error("Diagnostic actual artifact identity/digest unavailable.");
  const archiveBytes = binaryGH(
    repository,
    "/actions/artifacts/" + artifact.id + "/zip",
  );
  if ("sha256:" + hash(archiveBytes) !== artifact.digest)
    throw Error("Diagnostic remote artifact digest mismatch.");
  const temp = fs.mkdtempSync(
    path.join(path.dirname(diagnosticDirectory(repo)), "diagnostic-terminal-"),
  );
  let terminal, stdout, stderr;
  try {
    const archive = path.join(temp, "artifact.zip");
    fs.writeFileSync(archive, archiveBytes);
    const listed = spawnSync("unzip", ["-Z1", archive], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (listed.status !== 0)
      throw Error("Diagnostic terminal ZIP is unreadable.");
    const names = listed.stdout.trim().split("\n");
    if (
      names.length > 1024 ||
      new Set(names).size !== names.length ||
      names.some(
        (n) =>
          n.startsWith("/") || n.split("/").includes("..") || n.includes("\\"),
      ) ||
      !["terminal.json", "stdout.txt", "stderr.txt"].every((n) =>
        names.includes(n),
      )
    )
      throw Error("Diagnostic terminal ZIP entries missing or unsafe.");
    terminal = JSON.parse(zipEntry(archive, "terminal.json"));
    stdout = zipEntry(archive, "stdout.txt");
    stderr = zipEntry(archive, "stderr.txt");
    if (
      terminal.schemaVersion !== 1 ||
      terminal.kind !== "nonqualifying-diagnostic-terminal" ||
      terminal.source !== source ||
      terminal.sourceTree !== body.candidate.treeSha ||
      terminal.task !== body.task ||
      terminal.ordinal !== body.ordinal ||
      terminal.attempt !== body.attempt ||
      terminal.permit !== permit ||
      terminal.permitObject !== permitObject ||
      terminal.claimRef !== claimRef ||
      terminal.claimObject !== claimObject ||
      terminal.runId !== runId ||
      terminal.runAttempt !== 1 ||
      terminal.requiredGate !== body.requiredGate ||
      terminal.requiredGateStatus !== "failed" ||
      terminal.productQualification !== false ||
      terminal.execution?.stdoutSha256 !== hash(stdout) ||
      terminal.execution?.stderrSha256 !== hash(stderr) ||
      typeof terminal.execution.started !== "boolean" ||
      !terminal.execution.finishedAt
    )
      throw Error(
        "Diagnostic terminal artifact source/claim/result binding inconsistent.",
      );
    if (
      terminal.report &&
      (!names.includes(terminal.report.path) ||
        hash(zipEntry(archive, terminal.report.path)) !==
          terminal.report.sha256)
    )
      throw Error("Diagnostic capped report fingerprint changed.");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  // Canonical thread-only observation cannot pay native attribution, regardless
  // of its exit code or claimed status. Preserve the actual exit alongside it.
  const record = {
    schemaVersion: 1,
    kind: "nonqualifying-diagnostic-ci-result",
    state: "complete",
    git: { commit: source },
    execution: {
      exitCode: 1,
      signal: null,
      output: {
        stdout: logs.toString("utf8").slice(0, 65536),
        stderr: stderr.toString("utf8").slice(0, 65536),
      },
    },
    evidence: { status: "complete" },
    diagnostic: {
      terminal,
      monitorSha256: hash(summaryBytes),
      logsSha256: hash(logs),
      artifactSha256: hash(archiveBytes),
      artifactId: artifact.id,
      runId,
      runAttempt: 1,
      productQualification: false,
    },
  };
  const destination = path.join(
    path.dirname(receiptPath(repo, source)),
    "terminal-" + runId + "-1",
  );
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const [name, bytes] of Object.entries({
    "monitor-summary.json": summaryBytes,
    "logs.txt": logs,
    "artifact.zip": archiveBytes,
    "terminal.json": Buffer.from(JSON.stringify(terminal) + "\n"),
    "remote.json": Buffer.from(JSON.stringify({ run, jobs, artifact }) + "\n"),
  }))
    fs.writeFileSync(path.join(destination, name), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  await recordDiagnosticCIResult(repo, body.attempt, record);
  const state = await progressCommand("consume", {
    repo,
    task: body.task,
    attempt: body.attempt,
  });
  return {
    consumed: true,
    runId,
    runAttempt: 1,
    requiredGateStatus: "failed",
    productQualification: false,
    status: state.status,
    remaining: state.remaining,
    evidenceDirectory: destination,
  };
}
function publicClaim(value) {
  const { body, receipt, ...result } = value;
  return result;
}
export async function diagnosticCommand(repo, command, args) {
  if (command === "diagnostic-plan")
    return deriveDiagnosticImpact(repo, args[0], args[1]);
  if (command === "diagnostic-launch") return launchDiagnostic(repo, args[0]);
  if (command === "diagnostic-consume")
    return consumeDiagnostic(
      repo,
      args[0],
      JSON.parse(fs.readFileSync(args[1])),
    );
  if (command === "diagnostic-ci-run") return runDiagnosticCI(repo, ...args);
  if (command === "diagnostic-ci-claim")
    return publicClaim(claimDiagnostic(repo, ...args));
  if (command === "diagnostic-record")
    return recordDiagnosticReceipt(repo, JSON.parse(fs.readFileSync(args[0])));
  if (command === "diagnostic-verify") {
    const result = verifyDiagnosticReceipt(repo, args[0]);
    return {
      verified: true,
      kind: result.body.kind,
      source: args[0],
      task: result.body.task,
      ordinal: result.body.ordinal,
      attempt: result.body.attempt,
    };
  }
  throw Error("Unsupported diagnostic command.");
}
