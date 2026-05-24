#!/usr/bin/env bash
# v5_live_sanity.sh — Track T6 (Cycle 22). Live-sanity loop per RC.
#
# Two modes:
#   AUTODEV_LIVE=0 (default): dry-run. Simulates one inner-engine
#     state-machine tick deterministically. Writes a JSON to
#     reports/live-sanity/<ts>.json with the simulated transitions.
#     Exits 0.
#   AUTODEV_LIVE=1: requires HUMAN_CONFIG.runtime.live_sanity_authorized=true
#     (parsed from HUMAN_CONFIG.md or the file pointed to by
#     AUTODEV_HUMAN_CONFIG). Without the flag → exit 2 with refusal.
#     With the flag → exit 3 (placeholder; the real live path is
#     reserved for a future cycle to implement).
#
# Environment knobs:
#   AUTODEV_LIVE                 — 0 (default) | 1
#   AUTODEV_LIVE_SANITY_DIR      — output dir (default reports/live-sanity/)
#   AUTODEV_HUMAN_CONFIG         — path to HUMAN_CONFIG.md (default at repo root)
#
# Per L7 §0: never pushes to remote, never modifies main, never bypasses
# the codex budget guard. Dry-run is the always-safe default.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE=${AUTODEV_LIVE:-0}
OUT_DIR=${AUTODEV_LIVE_SANITY_DIR:-"${REPO_ROOT}/reports/live-sanity"}
CONFIG_FILE=${AUTODEV_HUMAN_CONFIG:-"${REPO_ROOT}/HUMAN_CONFIG.md"}

mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------
# Live-mode gate: requires HUMAN_CONFIG.runtime.live_sanity_authorized
# ---------------------------------------------------------------
if [[ "$LIVE" == "1" ]]; then
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "[live-sanity] AUTODEV_LIVE=1 but HUMAN_CONFIG.md not found at $CONFIG_FILE" >&2
    echo "[live-sanity] refusing: live_sanity_authorized cannot be confirmed" >&2
    exit 2
  fi
  # Parse `live_sanity_authorized: true|false` from the yaml block.
  authorized=$(python3 - "$CONFIG_FILE" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
m = re.search(r"live_sanity_authorized\s*:\s*(true|false)", text,
              re.IGNORECASE)
print("true" if m and m.group(1).lower() == "true" else "false")
PY
)
  if [[ "$authorized" != "true" ]]; then
    echo "[live-sanity] AUTODEV_LIVE=1 but live_sanity_authorized is not true in $CONFIG_FILE" >&2
    echo "[live-sanity] refusing: set HUMAN_CONFIG.runtime.live_sanity_authorized: true to enable" >&2
    exit 2
  fi
  # Authorized → placeholder. Real live path is a future cycle.
  echo "[live-sanity] AUTODEV_LIVE=1 + authorized: real live path not yet implemented" >&2
  echo "[live-sanity] exiting 3 (placeholder); see future Track L2/L3 for the live tick" >&2
  exit 3
fi

# ---------------------------------------------------------------
# Dry-run mode (the always-safe default)
# ---------------------------------------------------------------
ts=$(date -u +%Y%m%d-%H%M%S)
out_file="${OUT_DIR}/${ts}.json"
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Simulate the inner-engine state machine deterministically. The states
# come from orchestrator/main.py's state machine in V4: new → planning →
# coding → reviewing → ci_running → human_review. Each transition is
# logged as a synthetic event with a millisecond-scale "duration_ms".
python3 - "$out_file" "$started_at" <<'PY'
import json, sys
from datetime import datetime, timezone
out_file, started_at = sys.argv[1], sys.argv[2]
states = ["new", "planning", "coding", "reviewing", "ci_running",
          "human_review"]
transitions = []
for i in range(len(states) - 1):
    transitions.append({
        "from": states[i], "to": states[i + 1],
        "duration_ms": 50 + i * 10,
        "ok": True,
    })
ended_at = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")\
                                         .replace("+00:00", "Z")
data = {
    "started_at": started_at,
    "ended_at": ended_at,
    "mode": "dry-run",
    "state_transitions": transitions,
    "result": "ok",
    "notes": ("Dry-run: no real role invocations, no GitHub, no codex. "
              "Live path requires AUTODEV_LIVE=1 + "
              "HUMAN_CONFIG.runtime.live_sanity_authorized=true."),
}
with open(out_file, "w") as f:
    json.dump(data, f, indent=2)
print(out_file)
PY

echo "[live-sanity] dry-run wrote $out_file"
exit 0
