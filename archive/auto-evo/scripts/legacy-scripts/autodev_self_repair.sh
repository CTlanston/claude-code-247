#!/usr/bin/env bash
# autodev_self_repair.sh — Cycle δ self-repair handler.
#
# Invoked by scripts/autodev_continuous_cycle.sh when the same failure
# signature has been observed 3 (or AUTODEV_SELF_REPAIR_THRESHOLD)
# consecutive wakes.
#
# Usage: bash scripts/autodev_self_repair.sh <cycle_log_path> <signature>
#
# Scope (intentionally minimal — ADR-0012 §Decision):
#   1. Append one entry to reports/self-repair.log documenting the trigger.
#   2. Write BLOCKED.md with the failure signature, the tail of the cycle
#      log, and three plausible operator actions.
#
# What this script does NOT do (deferred to a future cycle):
#   - Pattern-match the failure (e.g., "Not logged in" → re-source .env;
#     "rate limit" → write quota-rate-limit-until.ts). Doing that
#     responsibly requires invoking `claude -p` recursively, which
#     enlarges the test surface and re-introduces the keychain-ACL
#     concern Cycle β just closed. Future cycle scope.
#
# Honors §0 constraint #3: never reads .env, secrets/, or *.key/.pem.
# Reads only the cycle log + writes BLOCKED.md + self-repair.log.

set -u

REPO=${AUTODEV_REPO_ROOT:-"$(cd "$(dirname "$0")/.." && pwd)"}
cycle_log=${1:-}
signature=${2:-unknown}

cd "$REPO" || exit 0

if [[ -z "$cycle_log" || ! -f "$cycle_log" ]]; then
  echo "[self-repair] cycle log missing or not provided: '$cycle_log'" >&2
  exit 1
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p reports

# 1. Append to self-repair.log (gitignored under reports/runs/ pattern —
#    but reports/self-repair.log is a separate root-level file. Decide
#    later whether to gitignore it; for now it's tracked so the audit
#    trail is visible.)
echo "[${ts}] trigger signature=${signature:0:16}... cycle_log=${cycle_log}" \
  >> reports/self-repair.log

# 2. Write BLOCKED.md — the operator's escalation signal.
#    Use a here-doc so the format is deterministic.
log_tail=$(tail -20 "$cycle_log" 2>/dev/null || echo "(cycle log unreadable)")

cat > BLOCKED.md <<EOF
# BLOCKED — same-signature failure observed 3 consecutive wakes

**Detected**: ${ts}
**Trigger**: \`scripts/autodev_self_repair.sh\` invoked by
  \`scripts/autodev_continuous_cycle.sh\` (Cycle δ; ADR-0012)
**Signature**: \`${signature}\`
**Cycle log**: \`${cycle_log}\`

## Last 20 lines of the failing cycle log

\`\`\`
${log_tail}
\`\`\`

## Three plausible operator actions

1. **Consult the full cycle log** at \`${cycle_log}\` for context
   above the tail. Look for unique error tokens, stack traces, or
   the first divergence from a successful cycle log.
2. **Check the launchd plist** at
   \`~/Library/LaunchAgents/com.lanston.autodev.continuous.plist\`
   matches what \`scripts/install_launchd_continuous.sh --dry-run\`
   would produce. Drift can mean an old PATH or stale HOME — Cycle β
   + γ codified the expected content.
3. **Run \`scripts/autodev_doctor.sh\`** and address any required
   failures (gh missing, dependency missing, etc.) before
   re-enabling the launchd agent.

## After resolving

Delete this BLOCKED.md so the next wake proceeds normally:

\`\`\`bash
rm BLOCKED.md
\`\`\`

The self-repair counter has already been cleared; the next wake
will start fresh and observe a clean signature window.

## Why this auto-fix is conservative

This script intentionally does NOT attempt to auto-fix the
failure. Pattern-matching against known failure modes (e.g.,
"Not logged in", rate-limit, command-not-found) requires
invoking \`claude -p\` recursively, which re-introduces the
keychain-ACL concern Cycle β closed and significantly enlarges
the test surface. ADR-0012 documents this scope choice and
identifies the future cycle that would lift it.
EOF

echo "[self-repair] wrote BLOCKED.md (signature=${signature:0:16}...)" >&2
exit 0
