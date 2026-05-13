#!/usr/bin/env bash
# update_goldens.sh — Track T7 (Cycle 23).
#
# The ONLY supported way to refresh tests/golden/ fixtures. Prompts for
# operator confirmation; only proceeds on literal "y" or "yes". Exit
# codes:
#   0 — refresh succeeded
#   1 — operator declined
#   2 — capture failed
#
# Usage:
#   bash scripts/update_goldens.sh
#
# Stdin is also accepted (e.g. `yes | bash scripts/update_goldens.sh`
# in tests).

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GOLDEN_DIR="${REPO_ROOT}/tests/golden"

echo "[update_goldens] About to refresh tests/golden/ fixtures."
echo "[update_goldens] This affects 4 files. Existing content WILL be replaced."
echo
read -r -p "Continue? [y/N] " response || response=""
case "$(echo "$response" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
  y|yes) ;;
  *)
    echo "[update_goldens] declined; no changes made"
    exit 1
    ;;
esac

mkdir -p "$GOLDEN_DIR"

python3 - "$GOLDEN_DIR" <<'PY'
import json, sys, os
from pathlib import Path
golden_dir = Path(sys.argv[1])
repo = golden_dir.parent.parent
os.environ.setdefault("STATE_DIR", str(repo / "state"))
sys.path.insert(0, str(repo / "orchestrator"))

import billable, preflight, review_panel as rp
import main as orch_main

# 1
out = billable.to_billable_cost(
    raw_cost_usd=42.50, in_tokens=1000, out_tokens=500,
    env={"CLAUDE_CODE_OAUTH_TOKEN": "fixture-token"},
)
(golden_dir / "billable_to_billable_cost_subscription.txt").write_text(
    f"{out:.4f}\n"
)

# 2
result = preflight.preflight_issue(
    title="Add helper utility multiply(a, b)",
    body="Add multiply(a, b) to src/math.py with unit tests.",
    repo_root=repo,
)
(golden_dir / "preflight_benign_issue.txt").write_text(
    f"ok={result.ok}\n"
    f"terminal_status={result.terminal_status}\n"
    f"reason={result.reason}\n"
    f"detected_symbols={sorted(result.detected_symbols)}\n"
    f"detected_files={sorted(result.detected_files)}\n"
    f"forbidden_files={sorted(result.forbidden_files)}\n"
)

# 3
pv = rp.n_of_3("approve", "approve", "approve")
(golden_dir / "n_of_3_unanimous_approve.json").write_text(
    json.dumps({
        "overall": pv.overall,
        "votes": pv.votes,
        "agree_count": pv.agree_count,
        "disagreement_summary": pv.disagreement_summary,
        "escalate": pv.escalate,
    }, sort_keys=True, indent=2) + "\n"
)

# 4
(golden_dir / "tdd_intent_regex_patterns.txt").write_text(
    f"_TEST_COMMIT_RE={orch_main._TEST_COMMIT_RE.pattern}\n"
    f"_IMPL_COMMIT_RE={orch_main._IMPL_COMMIT_RE.pattern}\n"
)

for f in sorted(golden_dir.iterdir()):
    if f.is_file() and not f.name.startswith("."):
        print(f"  refreshed {f.relative_to(repo)} ({f.stat().st_size}b)")
PY

rc=$?
if [[ $rc -ne 0 ]]; then
  echo "[update_goldens] capture failed with rc=$rc" >&2
  exit 2
fi

echo "[update_goldens] refreshed 4 fixtures in tests/golden/"
echo "[update_goldens] Now run: python3 -m pytest tests/test_golden_diff.py -q"
exit 0
