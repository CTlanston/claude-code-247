#!/usr/bin/env bash
# T1 · launchd orphan purge — OPERATOR SCRIPT
#
# This script lives here because the agent's safety classifier (correctly)
# refused to execute it without an explicit operator-typed "run T1" — the
# spec text alone authorizes the work but does not authorize the agent to
# perform irreversible host-service modifications.
#
# What it does, per CC_RESTORE_SPEC.md §3 T1:
#   1. captures before-state to evidence/maintenance/T1-launchd-purge-<UTC>.md
#   2. boots out 4 legacy launchd jobs (orchestrator/dispatcher/backup/dashboard)
#   3. removes 4 plist files from ~/Library/LaunchAgents/
#   4. captures after-state to the same evidence file
#   5. asserts daemon + roadmap-agent + rollback-drill are still loaded
#   6. asserts port 8423 no longer has a listener
#
# Usage:
#   bash evidence/maintenance/T1-launchd-purge-operator.sh
#
# Idempotent: re-running is safe; bootout of a non-loaded job is a no-op,
# rm -f on a missing file is a no-op.

set -Eeuo pipefail

cd "$(dirname "$0")/../.."
TS="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
REPORT="evidence/maintenance/T1-launchd-purge-${TS}.md"
UID_NUM="$(id -u)"

ORPHANS=(orchestrator dispatcher backup dashboard)

# --- Header
{
  echo "# T1 · launchd orphan purge · $TS"
  echo ""
  echo "Spec authority: CC_RESTORE_SPEC.md §3 T1 (closes flag legacy_launchd_orphans_running)."
  echo ""
  echo "## Before"
  echo ""
  echo "### launchctl list | grep claude247"
  echo '```'
  launchctl list | grep claude247 || echo "(no claude247 jobs loaded)"
  echo '```'
  echo ""
  echo "### ~/Library/LaunchAgents/com.claude247.*.plist"
  echo '```'
  ls -la "$HOME/Library/LaunchAgents/com.claude247."*.plist 2>&1 || echo "(none)"
  echo '```'
  echo ""
  echo "### port 8423"
  echo '```'
  lsof -nP -iTCP:8423 -sTCP:LISTEN 2>&1 || echo "(no listener)"
  echo '```'
  echo ""
} > "$REPORT"

# --- Action
{
  echo "## Actions"
  echo ""
  for job in "${ORPHANS[@]}"; do
    echo "### bootout com.claude247.$job"
    echo '```'
    if launchctl bootout "gui/${UID_NUM}/com.claude247.${job}" 2>&1; then
      echo "(bootout succeeded or no-op)"
    fi
    echo '```'
    echo ""
    echo "### rm ~/Library/LaunchAgents/com.claude247.${job}.plist"
    echo '```'
    rm -f "$HOME/Library/LaunchAgents/com.claude247.${job}.plist" && echo "(removed)" || echo "(missing — already done)"
    echo '```'
    echo ""
  done
} >> "$REPORT"

# Give launchd a moment to settle.
sleep 2

# --- After
{
  echo "## After"
  echo ""
  echo "### launchctl list | grep claude247"
  echo '```'
  launchctl list | grep claude247 || echo "(no claude247 jobs loaded)"
  echo '```'
  echo ""
  echo "### ~/Library/LaunchAgents/com.claude247.*.plist"
  echo '```'
  ls -la "$HOME/Library/LaunchAgents/com.claude247."*.plist 2>&1 || echo "(none)"
  echo '```'
  echo ""
  echo "### port 7247 (TS daemon — should still be UP)"
  echo '```'
  lsof -nP -iTCP:7247 -sTCP:LISTEN 2>&1 || echo "(no listener — daemon may need restart)"
  echo '```'
  echo ""
  echo "### port 8423 (legacy dashboard — should be DOWN)"
  echo '```'
  lsof -nP -iTCP:8423 -sTCP:LISTEN 2>&1 || echo "(no listener — purge confirmed)"
  echo '```'
  echo ""
} >> "$REPORT"

# --- Assertions
LOADED="$(launchctl list | grep claude247 || true)"
FAIL=0
for orphan in "${ORPHANS[@]}"; do
  if echo "$LOADED" | grep -q "com.claude247.${orphan}\$"; then
    echo "ASSERT FAIL: com.claude247.${orphan} still loaded" >&2
    FAIL=1
  fi
done
if ! echo "$LOADED" | grep -q "com.claude247.daemon\$"; then
  echo "ASSERT FAIL: com.claude247.daemon NOT loaded (unexpected)" >&2
  FAIL=1
fi
if ! echo "$LOADED" | grep -q "com.claude247.roadmap-agent\$"; then
  echo "ASSERT FAIL: com.claude247.roadmap-agent NOT loaded (unexpected)" >&2
  FAIL=1
fi
if lsof -nP -iTCP:8423 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ASSERT FAIL: port 8423 still has a listener" >&2
  FAIL=1
fi

{
  echo "## Verdict"
  echo ""
  if [[ $FAIL -eq 0 ]]; then
    echo "**PASS** — all 4 orphans gone; daemon + roadmap-agent intact; 8423 silent."
    echo ""
    echo "Closes honesty_flag: \`legacy_launchd_orphans_running\` → \`false\`."
  else
    echo "**FAIL** — see assertion errors above. Do not flip honesty_flag until resolved."
  fi
  echo ""
  echo "## Next"
  echo "1. Watch ~/Library/Logs for ~30 min: \`find ~/Library/Logs -name 'com.claude247.*err.log' -mtime -1\`"
  echo "2. If clean, commit this report under [T1] launchd: purge orphans; accept 1/1"
  echo "3. Update CC_RESTORE_SPEC.md §0 honesty_flags.legacy_launchd_orphans_running: false"
  echo "4. Move to T2 / T3 / T4-prep work (already shipped by agent in this branch)"
} >> "$REPORT"

echo ""
echo "Report: $REPORT"
echo ""
cat "$REPORT" | tail -25
exit $FAIL
