// External GitHub process boundary for isolated public-command tests only.
const fs = require("fs"),
  crypto = require("crypto"),
  file = process.env.DIAGNOSTIC_FAKE_STATE,
  lock = file + ".lock";
let acquired = false;
for (let i = 0; i < 250; i++) {
  try {
    fs.mkdirSync(lock);
    acquired = true;
    break;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
if (!acquired) throw Error("fixture busy");
let code = 0,
  output;
try {
  const state = JSON.parse(fs.readFileSync(file)),
    args = process.argv.slice(2),
    id = (data) =>
      crypto.createHash("sha1").update(JSON.stringify(data)).digest("hex");
  state.requests ??= [];
  state.requests.push(args);
  const fail = (message) => {
    code = 1;
    output = message;
  };
  if (args[0] === "issue") output = state.issues[args[2]];
  else if (args[0] === "run" && args[1] === "view") {
    output = args.includes("--log")
      ? state.logs
      : {
          databaseId: Number(state.run.id),
          headSha: state.run.head_sha,
          status: state.run.status,
          conclusion: state.run.conclusion,
          event: state.run.event,
          headBranch: state.run.head_branch,
          workflowName: state.run.name,
          jobs: state.jobs,
          attempt: state.run.run_attempt,
        };
  } else if (args[0] === "workflow" && args[1] === "run") {
    state.dispatches.push(args);
    output = { dispatched: true };
  } else if (args[0] === "api") {
    const endpoint = args.find((value) => value.startsWith("repos/")),
      method = args.includes("--method")
        ? args[args.indexOf("--method") + 1]
        : "GET",
      data = args.includes("--input")
        ? JSON.parse(fs.readFileSync(0, "utf8"))
        : {};
    if (endpoint.endsWith("/comments"))
      output = [state.issues[endpoint.split("/").at(-2)].comments];
    else if (endpoint.includes("/git/ref/")) {
      const ref = "refs/" + endpoint.split("/git/ref/")[1];
      output = state.refs[ref]
        ? { ref, object: { sha: state.refs[ref], type: "commit" } }
        : null;
      if (!output) fail("HTTP 404");
    } else if (endpoint.endsWith("/git/refs") && method === "POST") {
      if (state.refs[data.ref]) fail("HTTP 422 reference exists");
      else {
        state.refs[data.ref] = data.sha;
        state.publications++;
        output = { ref: data.ref, object: { sha: data.sha, type: "commit" } };
      }
    } else if (endpoint.endsWith("/git/blobs") && method === "POST") {
      const sha = id(data);
      state.blobs[sha] = data;
      state.publications++;
      output = { sha };
    } else if (endpoint.includes("/git/blobs/"))
      output =
        state.blobs[endpoint.split("/").at(-1)] ?? (fail("HTTP 404"), null);
    else if (endpoint.endsWith("/git/trees") && method === "POST") {
      const sha = id(data);
      state.trees[sha] = data;
      state.publications++;
      output = { sha };
    } else if (endpoint.includes("/git/trees/")) {
      const tree = state.trees[endpoint.split("/").at(-1).split("?")[0]];
      if (!tree) {
        fail("HTTP 404");
        output = null;
      } else {
        const directories = [
          ...new Set(
            tree.tree.flatMap((row) => {
              const parts = row.path.split("/");
              return parts
                .slice(0, -1)
                .map((_, index) => parts.slice(0, index + 1).join("/"));
            }),
          ),
        ].map((path) => ({
          path,
          mode: "040000",
          type: "tree",
          sha: id(path),
        }));
        output = {
          tree: endpoint.includes("?recursive=")
            ? [...directories, ...tree.tree]
            : [
                ...directories.filter((row) => !row.path.includes("/")),
                ...tree.tree.filter((row) => !row.path.includes("/")),
              ],
          truncated: false,
        };
      }
    } else if (endpoint.endsWith("/git/commits") && method === "POST") {
      const sha = id(data);
      state.commits[sha] = data;
      state.publications++;
      output = { sha };
    } else if (endpoint.includes("/git/commits/"))
      output =
        state.commits[endpoint.split("/").at(-1)] ?? (fail("HTTP 404"), null);
    else if (
      endpoint.includes("/actions/artifacts/") &&
      endpoint.endsWith("/zip")
    )
      output = Buffer.from(state.artifactZip, "base64");
    else if (endpoint.includes("/actions/runs/") && endpoint.endsWith("/jobs"))
      output = { jobs: state.jobs };
    else if (endpoint.includes("/actions/runs/") && endpoint.endsWith("/logs"))
      output = state.logs;
    else if (
      endpoint.includes("/actions/runs/") &&
      endpoint.endsWith("/artifacts")
    )
      output = { artifacts: state.artifacts ?? [] };
    else if (endpoint.includes("/actions/runs/")) output = state.run;
    else if (endpoint.includes("/commits/")) {
      const sha = endpoint.split("/").at(-1);
      output =
        sha === state.source
          ? { sha, commit: { tree: { sha: state.tree } } }
          : (fail("HTTP 404"), null);
    } else fail("unsupported fixture endpoint " + endpoint);
  } else fail("unsupported fixture CLI");
  fs.writeFileSync(file, JSON.stringify(state));
} finally {
  fs.rmdirSync(lock);
}
if (code) {
  process.stderr.write(String(output));
  process.exit(code);
}
if (Buffer.isBuffer(output)) process.stdout.write(output);
else if (typeof output === "string") process.stdout.write(output);
else process.stdout.write(JSON.stringify(output));
