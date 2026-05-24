#!/usr/bin/env bash
# autodev_report.sh — write reports/daily.md from current state and print it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 -m autodev.supervisor --report
echo
echo "=== reports/daily.md ==="
cat reports/daily.md
