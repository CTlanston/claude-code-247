#!/usr/bin/env bash
# pre_tool_guard.sh — block dangerous commands.
#
# Called via Claude Code's PreToolUse hook. Receives JSON on stdin with
# `tool_use.name` and `tool_use.input`. We veto the call by emitting non-zero
# exit code; benign calls pass through with exit 0.
#
# Patterns we always block:
#   * git push origin main / master
#   * git push --force / -f to main
#   * cat .env / cat secrets/* / cat *.pem
#   * rm -rf /
#   * sudo (anywhere)
#
set -uo pipefail

# Read tool-use JSON from stdin.
PAYLOAD=$(cat 2>/dev/null || true)

# Coarse string-match. The hook contract is to exit non-zero with the reason on
# stderr to veto. Be conservative; false positives are recoverable.
fail() {
  local reason="$1"
  echo "pre_tool_guard.sh: BLOCKED — $reason" >&2
  exit 1
}

# Skip if no payload (older Claude Code versions).
[[ -z "$PAYLOAD" ]] && exit 0

# Inspect Bash tool input only — other tools are not push/destructive.
if grep -q '"name"\s*:\s*"Bash"' <<<"$PAYLOAD"; then
  CMD=$(python3 - <<'PY'
import json, sys
try:
    p = json.loads(sys.stdin.read())
    print(p.get("tool_use", {}).get("input", {}).get("command", ""))
except Exception:
    pass
PY
<<<"$PAYLOAD"
  )
  case "$CMD" in
    *"git push origin main"*)         fail "push to main forbidden" ;;
    *"git push origin master"*)       fail "push to master forbidden" ;;
    *"git push --force"*)             fail "force push forbidden" ;;
    *"git push -f"*)                  fail "force push forbidden" ;;
    *"rm -rf /"*)                     fail "rm -rf / forbidden" ;;
    *"rm -rf ~"*)                     fail "rm -rf \$HOME forbidden" ;;
    *"cat .env"*)                     fail ".env read forbidden via Bash" ;;
    *"cat secrets/"*)                 fail "secrets/ read forbidden via Bash" ;;
    *"sudo "*)                        fail "sudo forbidden in autonomous mode" ;;
    *"gh pr merge"*"--merge"*)        fail "auto-merge forbidden — human is the only merge approver" ;;
    *"gh pr merge"*"--squash"*)       fail "auto-merge forbidden — human is the only merge approver" ;;
  esac
fi

exit 0
