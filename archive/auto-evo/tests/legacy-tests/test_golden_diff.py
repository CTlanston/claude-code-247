"""Golden-diff tests (Track T7 / Cycle 23).

Each test compares the current output of a stable function against a
captured `tests/golden/<name>` fixture. On mismatch:
  - The unified diff is written to `cycles/<CYCLE_ID>/golden-diff.md`
    (so the operator sees the exact drift)
  - The test FAILS — there is NO auto-update
  - Refreshing the fixture is intentional human work: run
    `scripts/update_goldens.sh` which prompts for confirmation

This is the strongest signal in the regression suite: any change to
the stable function's output is loud, regardless of whether the
change was deliberate.
"""
from __future__ import annotations

import difflib
import json
import os
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
GOLDEN_DIR = REPO_ROOT / "tests" / "golden"
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))


def _write_diff_if_mismatch(actual: str, expected: str, fixture: str) -> str:
    """Write a unified diff to cycles/<id>/golden-diff.md when actual ≠
    expected. Returns the diff string for the assertion message."""
    if actual == expected:
        return ""
    diff = "\n".join(
        difflib.unified_diff(
            expected.splitlines(),
            actual.splitlines(),
            fromfile=f"golden/{fixture}",
            tofile=f"current ({fixture})",
            lineterm="",
        )
    )
    cycle_id = os.environ.get("CYCLE_ID")
    if not cycle_id:
        return diff
    out_dir = REPO_ROOT / "cycles" / cycle_id
    if out_dir.exists():
        diff_file = out_dir / "golden-diff.md"
        # Append rather than overwrite — multiple fixtures may drift
        prefix = f"## Golden drift on `{fixture}`\n\n```diff\n"
        suffix = "\n```\n\n"
        if diff_file.exists():
            existing = diff_file.read_text()
            diff_file.write_text(existing + prefix + diff + suffix)
        else:
            diff_file.write_text(prefix + diff + suffix)
    return diff


# --- Stable fixtures -------------------------------------------------


def test_golden_to_billable_cost_subscription():
    import billable
    actual = f"{billable.to_billable_cost(raw_cost_usd=42.50, in_tokens=1000, out_tokens=500, env={'CLAUDE_CODE_OAUTH_TOKEN': 'fixture-token'}):.4f}\n"
    expected = (GOLDEN_DIR / "billable_to_billable_cost_subscription.txt").read_text()
    diff = _write_diff_if_mismatch(actual, expected,
                                     "billable_to_billable_cost_subscription.txt")
    assert actual == expected, (
        f"Golden mismatch on to_billable_cost. Diff:\n{diff}\n"
        "To accept the new output: bash scripts/update_goldens.sh"
    )


def test_golden_preflight_benign_issue():
    import preflight
    result = preflight.preflight_issue(
        title="Add helper utility multiply(a, b)",
        body="Add multiply(a, b) to src/math.py with unit tests.",
        repo_root=REPO_ROOT,
    )
    actual = (
        f"ok={result.ok}\n"
        f"terminal_status={result.terminal_status}\n"
        f"reason={result.reason}\n"
        f"detected_symbols={sorted(result.detected_symbols)}\n"
        f"detected_files={sorted(result.detected_files)}\n"
        f"forbidden_files={sorted(result.forbidden_files)}\n"
    )
    expected = (GOLDEN_DIR / "preflight_benign_issue.txt").read_text()
    diff = _write_diff_if_mismatch(actual, expected,
                                     "preflight_benign_issue.txt")
    assert actual == expected, (
        f"Golden mismatch on preflight_issue. Diff:\n{diff}\n"
        "Refresh via scripts/update_goldens.sh after reviewing intent."
    )


def test_golden_n_of_3_unanimous_approve():
    import review_panel as rp
    pv = rp.n_of_3("approve", "approve", "approve")
    actual = json.dumps({
        "overall": pv.overall,
        "votes": pv.votes,
        "agree_count": pv.agree_count,
        "disagreement_summary": pv.disagreement_summary,
        "escalate": pv.escalate,
    }, sort_keys=True, indent=2) + "\n"
    expected = (GOLDEN_DIR / "n_of_3_unanimous_approve.json").read_text()
    diff = _write_diff_if_mismatch(actual, expected,
                                     "n_of_3_unanimous_approve.json")
    assert actual == expected, (
        f"Golden mismatch on n_of_3. Diff:\n{diff}\n"
        "Refresh via scripts/update_goldens.sh."
    )


def test_golden_tdd_intent_regex_patterns():
    import main as orch_main
    actual = (
        f"_TEST_COMMIT_RE={orch_main._TEST_COMMIT_RE.pattern}\n"
        f"_IMPL_COMMIT_RE={orch_main._IMPL_COMMIT_RE.pattern}\n"
    )
    expected = (GOLDEN_DIR / "tdd_intent_regex_patterns.txt").read_text()
    diff = _write_diff_if_mismatch(actual, expected,
                                     "tdd_intent_regex_patterns.txt")
    assert actual == expected, (
        f"Golden mismatch on TDD-intent regex patterns. Diff:\n{diff}\n"
        "Changes to these regexes affect FAIL-0001 fix coverage; refresh "
        "ONLY after deliberate review."
    )


# --- Mismatch propagation -------------------------------------------


def test_mismatch_writes_diff_when_cycle_id_set(tmp_path, monkeypatch):
    """When CYCLE_ID env is set and cycles/<id>/ exists, the helper
    appends a unified diff to cycles/<id>/golden-diff.md on mismatch."""
    cycle_id = "20990101-000000"
    monkeypatch.setenv("CYCLE_ID", cycle_id)
    (REPO_ROOT / "cycles" / cycle_id).mkdir(parents=True, exist_ok=True)
    try:
        diff = _write_diff_if_mismatch("actual\n", "expected\n", "fake.txt")
        assert "expected" in diff and "actual" in diff
        diff_file = REPO_ROOT / "cycles" / cycle_id / "golden-diff.md"
        assert diff_file.exists()
        assert "Golden drift on `fake.txt`" in diff_file.read_text()
    finally:
        import shutil
        shutil.rmtree(REPO_ROOT / "cycles" / cycle_id, ignore_errors=True)


def test_no_diff_when_actual_equals_expected():
    """Equal strings produce empty diff and no file write."""
    diff = _write_diff_if_mismatch("same\n", "same\n", "fake.txt")
    assert diff == ""
