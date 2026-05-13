#!/usr/bin/env bash
# autodev_health.sh — CLI entrypoint for the health scorer.
#
# Per AUTODEV_L7_MASTER_PROMPT.md §10. Computes the health score from
# on-disk state and writes:
#   reports/health.json           (machine; wake script reads this)
#   reports/health.md             (human-readable summary)
#   reports/health.history.jsonl  (one append-line per call; trend)
#
# Usage:
#   bash scripts/autodev_health.sh
#   bash scripts/autodev_health.sh --repo /path/to/other/repo

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/../orchestrator/health.py" "$@"
