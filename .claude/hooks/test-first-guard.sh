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

case "$file" in */tests.js) exit 0 ;; esac

case "$file" in
  */scripts/test-first-gate.mjs|*/.claude/hooks/test-first-guard.sh|*/.github/workflows/*.yml|*/.github/workflows/*.yaml) ;;
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

# Unstaged or staged changes to tests.js both count as "a test was written".
if ! git -C "$repo" diff --quiet -- tests.js || ! git -C "$repo" diff --cached --quiet -- tests.js; then
  exit 0
fi

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Test-first guard: tests.js has no uncommitted changes, so this app edit is implementation arriving before its test. Write the failing test in tests.js first, run it, and watch it fail for the right reason — then this edit goes through. Pure documentation is exempt."
  }
}
JSON
exit 0
