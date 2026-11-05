#!/usr/bin/env bash
# Test-first guard for Chain Scanner.
#
# The browser app can grow new modules, so this guard uses runtime file types
# instead of a frozen list of current filenames. Gate, hook, and CI
# workflow edits are protected too because they can weaken this process.
#
# The legitimate way past it is the one the discipline asks for anyway: write
# the failing test first. Genuine exceptions (a pure doc change, deleting code)
# live in README.md / SETUP.md, which this never looks at.
set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')

case "$file" in
  */scripts/test-first-gate.mjs|*/scripts/release-evidence.mjs|*/scripts/install-release-hook.mjs|*/.claude/hooks/test-first-guard.sh|*/.github/workflows/*.yml|*/.github/workflows/*.yaml) ;;
  *)
    case "$file" in
      */.git/*|*/.github/*|*/.claude/*|*/audits/*|*/node_modules/*|*/scripts/*) exit 0 ;;
    esac
    case "$file" in
      *.html|*.js|*.mjs|*.cjs|*.jsx|*.ts|*.tsx|*.css|*.scss|*.webmanifest|*.svg|*.png|*.jpg|*.jpeg|*.webp|*.avif|*/firestore.rules) ;;
      *) exit 0 ;;
    esac
    ;;
esac

repo=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0

# Git reports the resolved top level, so compare against the resolved path.
resolved="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"
case "${resolved#"$repo"/}" in
  # The test surface is the per-area tests/ directory (#2213); writing tests is
  # always allowed. Keep this case in sync with isTestFile in
  # scripts/test-first-gate.mjs, which a shell hook cannot import.
  tests/*) exit 0 ;;
  # Nothing runs a root tests.js since the split, so a test written there
  # protects nothing: refuse it and point at the port.
  tests.js)
    cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Test-first guard: tests now live in the per-area files under tests/, and neither npm test nor the group runner runs a root tests.js. Write the test in the area file of its group instead, as the porting note in docs/agents/test-groups.md describes."
  }
}
JSON
    exit 0 ;;
esac

# Unstaged or staged changes to the test files both count as "a test was
# written"; a brand-new untracked test file counts too.
if ! git -C "$repo" diff --quiet -- tests || ! git -C "$repo" diff --cached --quiet -- tests ||
   [ -n "$(git -C "$repo" ls-files --others --exclude-standard -- tests 2>/dev/null)" ]; then
  exit 0
fi

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Test-first guard: the test files under tests/ have no uncommitted changes, so this app edit is implementation arriving before its test. Write the failing test in the matching tests/ file first, run it, and watch it fail for the right reason — then this edit goes through. Pure documentation is exempt."
  }
}
JSON
exit 0
