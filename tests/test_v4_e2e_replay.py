"""Deterministic e2e replay — simulates the V3 #14/#15/#16 scenarios
end-to-end against the V4 fixes, without any Docker / network / model calls.

This is the "shortest deterministic version" the V4 prompt allows in lieu
of the slow live driver harness.

Each scenario:
  - constructs a tmp state-dir + tmp repo
  - seeds the inner DB to a known starting state
  - invokes the orchestrator code paths the live system would invoke
  - asserts the V4-expected behaviour:
      #14 (chunks + edge-case-after-impl): TDD-intent gate passes
      #15 (impossible-spec): preflight terminalises before Coder
      #16 (clean cycle): no false-pause from Guardian-cost path
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))


# ============================================================================
# Scenario #14 — chunks() with edge-case test added after impl
# ============================================================================


def test_v4_scenario_14_edge_case_test_after_impl_passes_tdd_gate(monkeypatch):
    """V3 #14 was rejected because:
      1. test: scaffold basic chunks tests
      2. feat: implement chunks
      3. test: add n<0 edge-case test  ← Reviewer rejected ("test after impl")

    V4 intent policy: as long as at least ONE test commit precedes at
    least ONE feat commit, intent is satisfied. The trailing edge-case
    test is fine.
    """
    import orchestrator.main as orchestrator_main
    fake_commits_newest_first = [
        {"sha": "step3", "subject": "test: add n<0 edge-case test"},
        {"sha": "step2", "subject": "feat: implement chunks(items, n)"},
        {"sha": "step1", "subject": "test: scaffold basic chunks tests"},
    ]
    monkeypatch.setattr(
        orchestrator_main.git_proxy, "commit_log",
        lambda issue_id, base=None: fake_commits_newest_first,
    )
    assert orchestrator_main._check_tdd_invariant(14) is None, \
        "V4 TDD-intent gate must accept the #14 pattern that V3 rejected"


# ============================================================================
# Scenario #15 — reverse() impossible spec terminalises at preflight
# ============================================================================


def test_v4_scenario_15_impossible_spec_terminalises_at_preflight(tmp_path):
    """V3 #15 sat in `coding` forever because Coder kept reporting
    BLOCKED — reverse() absent. V4 preflight must detect this and mark
    the issue terminal BEFORE Planner / Coder spend tokens on it."""
    from orchestrator import preflight
    # Mirror the actual #15 issue body and repo state
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "utils.py").write_text(
        '"""Utility helpers — auto-edited by Claude agents."""\n'
    )
    body = (
        "The `reverse(s)` function in `src/utils.py` (added in earlier work) "
        "currently has minimal test coverage. Add comprehensive edge-case "
        "tests in `tests/test_reverse_edges.py` without modifying `reverse()` "
        "itself.\n\n"
        "Acceptance: 1. tests/test_reverse_edges.py exists. "
        "2. Do NOT modify `src/utils.py` or existing tests. "
        "3. TDD ordering."
    )
    pf = preflight.preflight_issue(
        title="Cycle2: Add edge-case tests for reverse()",
        body=body,
        repo_root=tmp_path,
    )
    assert pf.ok is False, "preflight must detect impossibility"
    assert pf.terminal_status == "failed"
    assert "reverse" in pf.detected_symbols
    assert "blocked_impossible_spec" in pf.reason


# ============================================================================
# Scenario #16 — clean cycle, Guardian does NOT false-pause
# ============================================================================


def test_v4_scenario_16_guardian_does_not_false_pause_under_subscription(
    monkeypatch, tmp_path
):
    """V3 #16's cycle completed fine but Guardian then pre-paused the
    NEXT cycle because it summed inflated runs.cost_usd. V4: under
    subscription mode the cost field is zeroed at INSERT time, so
    daily_cost_usd reports $0 and Guardian has nothing to flag."""
    monkeypatch.setenv("STATE_DIR", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-fake")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    # Re-import db so module-level STATE_DIR picks up the env override
    import importlib
    if "orchestrator.db" in sys.modules:
        importlib.reload(sys.modules["orchestrator.db"])
    from orchestrator import db, billable

    db.init()
    # Simulate 4 real Coder runs with non-zero estimated cost each
    for i in range(4):
        db.record_run(
            issue_id=16, role="coder",
            started_at=1000.0 + i * 100, finished_at=1010.0 + i * 100,
            exit_code=0, in_tokens=2000, out_tokens=1000, cost=2.50,
            summary=f"step {i}",
        )

    # Verify all 4 rows are in DB with ZERO cost (subscription mask)
    with sqlite3.connect(str(tmp_path / "orchestrator.db")) as c:
        rows = c.execute("SELECT cost_usd FROM runs WHERE issue_id=16").fetchall()
    assert len(rows) == 4
    assert all(r[0] == 0.0 for r in rows), \
        f"all subscription-mode runs must have cost_usd=0; got {rows}"

    # daily_cost_usd via the billable helper also reads zero
    m = billable.load_budget_metrics(tmp_path)
    assert m["is_subscription"] is True
    assert m["daily_cost_usd"] == 0.0


def test_v4_scenario_16_clean_cycle_under_api_mode_preserves_cost(
    monkeypatch, tmp_path
):
    """Mirror of above but for API mode — real cost must be preserved
    so the budget breaker still works."""
    import time
    monkeypatch.setenv("STATE_DIR", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-real-key")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    import importlib
    if "orchestrator.db" in sys.modules:
        importlib.reload(sys.modules["orchestrator.db"])
    from orchestrator import db, billable

    # Use "now" timestamps so load_budget_metrics' 24h window catches them.
    now = time.time()
    db.init()
    db.record_run(
        issue_id=16, role="coder",
        started_at=now - 60, finished_at=now,
        exit_code=0, in_tokens=2000, out_tokens=1000, cost=2.50,
        summary="real cost",
    )

    with sqlite3.connect(str(tmp_path / "orchestrator.db")) as c:
        row = c.execute("SELECT cost_usd FROM runs WHERE issue_id=16").fetchone()
    assert abs(row[0] - 2.50) < 1e-9, "API mode must preserve real cost"

    m = billable.load_budget_metrics(tmp_path)
    assert m["is_subscription"] is False
    assert m["daily_cost_usd"] > 0   # real spend visible to breaker


# ============================================================================
# Composite: 3 issues processed without manual intervention
# ============================================================================


def test_v4_composite_three_issues_no_intervention(monkeypatch, tmp_path):
    """Composite assertion: given the V4 codebase, the three V3 stuck
    issues all reach a terminal-or-safe state autonomously:
      #14 → TDD gate passes (would proceed to Reviewer)
      #15 → preflight terminalises (failed status, no token burn)
      #16 → clean cycle, no Guardian false-pause possible
    """
    monkeypatch.setenv("STATE_DIR", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-fake")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)

    import importlib
    if "orchestrator.db" in sys.modules:
        importlib.reload(sys.modules["orchestrator.db"])
    if "orchestrator.main" in sys.modules:
        importlib.reload(sys.modules["orchestrator.main"])
    from orchestrator import db, preflight, billable
    import orchestrator.main as om

    # --- #14: TDD intent ---
    monkeypatch.setattr(om.git_proxy, "commit_log", lambda i, base=None: [
        {"sha": "c", "subject": "test: add edge case after impl"},
        {"sha": "b", "subject": "feat: implement chunks"},
        {"sha": "a", "subject": "test: scaffold tests"},
    ])
    assert om._check_tdd_invariant(14) is None, "#14 must pass TDD intent"

    # --- #15: impossible spec ---
    (tmp_path / "src").mkdir(exist_ok=True)
    (tmp_path / "src" / "utils.py").write_text('"""utils."""\n')   # no reverse()
    pf = preflight.preflight_issue(
        title="Edge tests for reverse()",
        body="Test reverse() in src/utils.py. Do not modify src/utils.py.",
        repo_root=tmp_path,
    )
    assert pf.ok is False, "#15 must terminalise at preflight"
    assert pf.terminal_status == "failed"

    # --- #16: subscription-mode clean cycle ---
    db.init()
    db.record_run(
        issue_id=16, role="coder",
        started_at=999.0, finished_at=1000.0,
        exit_code=0, in_tokens=500, out_tokens=200, cost=1.10,
        summary="clean",
    )
    m = billable.load_budget_metrics(tmp_path)
    assert m["daily_cost_usd"] == 0.0, "#16 must not contribute to Guardian's budget under sub mode"
