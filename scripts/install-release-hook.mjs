import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function resolveHookLocation(repoRoot) {
  const root = git(repoRoot, ['rev-parse', '--show-toplevel']);
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const defaultHooks = path.resolve(git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']));
  let configured = '';
  try {
    configured = git(root, ['config', '--path', '--get', 'core.hooksPath']);
  } catch {
    configured = '';
  }
  const configuredHooks = configured
    ? path.resolve(path.isAbsolute(configured) ? configured : path.join(root, configured))
    : defaultHooks;
  if (configuredHooks !== defaultHooks) {
    throw new Error('Refusing to replace a custom core.hooksPath; preserve its dispatcher and install the release gate explicitly.');
  }
  return { root, common, hooks: defaultHooks, hook: path.join(defaultHooks, 'pre-push') };
}

function makeDispatcher(priorHookName) {
  const prior = priorHookName ? 'prior_hook="$hook_dir/' + priorHookName + '"\n' : '';
  return '#!/usr/bin/env bash\n' +
    '# codex-release-gate-managed-v1\n' +
    '# Shared by every worktree through the repository common git directory.\n' +
    'set -uo pipefail\n' +
    'payload=$(cat)\n' +
    'hook_dir=$(cd -- "$(dirname -- "$0")" && pwd)\n' +
    'prior_hook=""\n' +
    prior +
    'if [[ -n "$prior_hook" && -x "$prior_hook" ]]; then\n' +
    '  printf "%s\\n" "$payload" | "$prior_hook" "$@" || exit $?\n' +
    'fi\n' +
    'repo=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Release gate could not find this worktree." >&2; exit 1; }\n' +
    'validator="$repo/scripts/release-evidence.mjs"\n' +
    'if [[ ! -f "$validator" ]]; then\n' +
    '  echo "Release gate validator is missing from this checkout; update to a version with release evidence before pushing." >&2\n' +
    '  exit 1\n' +
    'fi\n' +
    'printf "%s\\n" "$payload" | node "$validator" pre-push "$@"\n';
}

export function installSharedPrePushHook(repoRoot) {
  const location = resolveHookLocation(repoRoot);
  fs.mkdirSync(location.hooks, { recursive: true });
  if (fs.existsSync(location.hook)) {
    const current = fs.readFileSync(location.hook, 'utf8');
    if (current.includes('codex-release-gate-managed-v1')) {
      const match = current.match(/^prior_hook="\$hook_dir\/([^"]+)"$/m);
      const priorName = match?.[1] || '';
      if (current !== makeDispatcher(priorName)) {
        throw new Error('Managed pre-push hook is modified or unrecognized; it was left untouched for inspection.');
      }
      let preservedHookPath = null;
      if (priorName) {
        const priorMatch = priorName.match(/^pre-push\.codex-preserved-([0-9a-f]{12})$/);
        if (!priorMatch) throw new Error('Managed pre-push hook names an invalid preserved hook; it was left untouched.');
        preservedHookPath = path.join(location.hooks, priorName);
        try {
          const priorStat = fs.statSync(preservedHookPath);
          const priorBytes = fs.readFileSync(preservedHookPath);
          const priorDigest = createHash('sha256').update(priorBytes).digest('hex').slice(0, 12);
          if (!priorStat.isFile() || priorDigest !== priorMatch[1]) {
            throw new Error('Managed pre-push hook backup is missing or has changed.');
          }
        } catch (error) {
          throw new Error('Managed pre-push hook backup cannot be verified; it was left untouched. ' + error.message);
        }
      }
      return { installed: false, hookPath: location.hook, preservedHookPath, commonDir: location.common };
    }
  }
  let priorName = '';
  let priorContents = '';
  let priorMode = 0o755;
  if (fs.existsSync(location.hook)) {
    const stat = fs.statSync(location.hook);
    if (!stat.isFile()) throw new Error('Existing pre-push hook is not a regular file; it was left untouched.');
    priorContents = fs.readFileSync(location.hook, 'utf8');
    priorMode = stat.mode & 0o777;
    const suffix = createHash('sha256').update(priorContents).digest('hex').slice(0, 12);
    priorName = 'pre-push.codex-preserved-' + suffix;
    const priorPath = path.join(location.hooks, priorName);
    if (fs.existsSync(priorPath)) {
      if (fs.readFileSync(priorPath, 'utf8') !== priorContents) throw new Error('A preserved pre-push hook already exists with different bytes.');
    } else {
      fs.writeFileSync(priorPath, priorContents, { flag: 'wx', mode: priorMode });
      fs.chmodSync(priorPath, priorMode);
    }
  }
  const temporary = location.hook + '.release-gate-' + process.pid;
  fs.writeFileSync(temporary, makeDispatcher(priorName), { flag: 'wx', mode: 0o755 });
  fs.renameSync(temporary, location.hook);
  fs.chmodSync(location.hook, 0o755);
  return {
    installed: true,
    hookPath: location.hook,
    preservedHookPath: priorName ? path.join(location.hooks, priorName) : null,
    commonDir: location.common,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = installSharedPrePushHook(process.cwd());
    process.stdout.write((result.installed ? 'Installed' : 'Already installed') + ' the shared release gate hook at ' + result.hookPath + '.\n');
    if (result.preservedHookPath) process.stdout.write('Preserved the prior hook at ' + result.preservedHookPath + ' and chained it before release validation.\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
