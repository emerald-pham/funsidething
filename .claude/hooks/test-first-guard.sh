#!/usr/bin/env bash
# Test-first guard for Chain Scanner.
#
# All the implementation lives in index.html and all the tests in tests.js, so
# "is there a test for this yet?" has a cheap mechanical answer: has tests.js
# been touched since the last commit? If not, an edit to index.html is
# implementation arriving before its test, and this blocks it.
#
# The legitimate way past it is the one the discipline asks for anyway: write
# the failing test first. Genuine exceptions (a pure doc change, deleting code)
# live in README.md / SETUP.md, which this never looks at.
set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')

case "$file" in
  */index.html) ;;
  *) exit 0 ;;
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
    "permissionDecisionReason": "Test-first guard: tests.js has no uncommitted changes, so this edit to index.html is implementation arriving before its test. Write the failing test in tests.js first, run it, and watch it fail for the right reason — then this edit goes through. (Pure docs live in README.md / SETUP.md and are never blocked. To lift the guard, edit .claude/settings.json.)"
  }
}
JSON
exit 0
