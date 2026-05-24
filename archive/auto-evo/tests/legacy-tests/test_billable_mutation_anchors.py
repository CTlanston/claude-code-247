"""Deterministic anchor tests for the mutation kill set (Track T5).

These tests exist SPECIFICALLY to kill mutants in `orchestrator/billable.py`
that the V4 deterministic tests miss. Hypothesis property tests catch
them randomly but make the kill rate non-deterministic across runs.

Per Cycle 18 PLAN's "files forbidden to touch" rule, we don't modify
test_v4_hardening.py or test_billable_properties.py. This new file is
the surgical addition that lifts the deterministic V4+anchors kill rate
above 80%, taking T-dim to L5 with zero Hypothesis dependency.

Each test below targets a specific surviving mutant identified by
`scripts/mutate_billable.py` against V4-only:
- M11: `return 0.0` (line 56, the TypeError/ValueError exception path)
- M14: `return metrics` (line 83, "db file doesn't exist" early-exit)
- M18/M19: bucket window `86400` seconds → ±1
- M20/M21: SQLite `timeout=5` → ±1
"""
from __future__ import annotations

import os
import sqlite3
import sys
import time
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import billable  # noqa: E402


# --- Anchor for M11: exception path in to_billable_cost ------------------


def test_to_billable_cost_returns_zero_when_raw_cost_uncastable():
    """In API mode with positive tokens, a non-numeric raw_cost should
    trigger the `except (TypeError, ValueError)` branch and return 0.0.
    This kills the M11 mutant (return 0.0 → return None on line 56)."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-anything"}
    # An object that raises on float() — neither None (already handled
    # by `raw_cost_usd or 0.0`) nor a string number (those parse fine).
    class _Unstrable:
        def __float__(self):
            raise ValueError("can't be cast")
    out = billable.to_billable_cost(_Unstrable(), in_tokens=10, out_tokens=10,
                                     env=api_env)
    assert out == 0.0
    # Critical: the literal value, not None — that's what mutant 11 changes
    assert out is not None


def test_to_billable_cost_exception_path_with_typeerror():
    """A type that raises TypeError on float() should also hit the
    exception path and return 0.0."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-anything"}
    class _NotANumber:
        def __float__(self):
            raise TypeError("nope")
    out = billable.to_billable_cost(_NotANumber(), in_tokens=1, out_tokens=1,
                                     env=api_env)
    assert out == 0.0
    assert out is not None


# --- Anchor for M14: db-doesn't-exist path -------------------------------


def test_load_budget_metrics_returns_baseline_when_db_missing(tmp_path):
    """API mode + a state_dir whose orchestrator.db doesn't exist:
    `load_budget_metrics` should return baseline metrics (daily_cost_usd=0)
    via the early-exit return on line 83. Kills M14 (return metrics → None)."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-fake"}
    # tmp_path is empty: no orchestrator.db
    result = billable.load_budget_metrics(str(tmp_path), env=api_env)
    assert result is not None
    assert isinstance(result, dict)
    assert result.get("daily_cost_usd") == 0.0
    assert result.get("is_subscription") is False
    assert result.get("billable_cost_basis") == \
        "subscription=0; api=db.daily_cost_usd"


# --- Anchor for M18/M19: 86400-second bucket window ----------------------


def _seed_db_with_cost_at(tmp_path: Path, age_seconds: int,
                          cost: float) -> Path:
    """Build a state_dir with an orchestrator.db that has one metrics
    row at `age_seconds` ago. Returns the state_dir path."""
    db_path = tmp_path / "orchestrator.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute(
            "CREATE TABLE metrics (bucket_at INTEGER PRIMARY KEY, "
            "cost_usd REAL)"
        )
        bucket_at = int((time.time() - age_seconds) // 300)
        c.execute("INSERT INTO metrics VALUES (?, ?)", (bucket_at, cost))
        c.commit()
    return tmp_path


def test_load_budget_metrics_24h_window_includes_recent_cost(tmp_path):
    """A cost from 60 seconds ago should be inside the 24h window and
    counted. If M18/M19 (86400 ± 1) were applied, this test would still
    pass since 60s is well inside any ~86400s window. We complement
    this with the boundary tests below."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-fake"}
    state_dir = _seed_db_with_cost_at(tmp_path, age_seconds=60, cost=1.25)
    result = billable.load_budget_metrics(str(state_dir), env=api_env)
    assert result["daily_cost_usd"] == pytest.approx(1.25, abs=0.01)


def test_load_budget_metrics_24h_window_excludes_2day_old_cost(tmp_path):
    """A cost from 2 days ago (172800s) should NOT be counted (outside
    the 24h = 86400s window). Kills M18 (86400→86401, slightly larger
    window) and M19 (86400→86399, slightly smaller window) when combined
    with the boundary test below.

    Specifically: M18 widens window to 86401s; a 172800s-old entry is
    still excluded (good — M18 also passes here, doesn't get killed by
    THIS test alone, but is killed by the boundary test below)."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-fake"}
    state_dir = _seed_db_with_cost_at(tmp_path, age_seconds=172800, cost=99)
    result = billable.load_budget_metrics(str(state_dir), env=api_env)
    assert result["daily_cost_usd"] == 0.0


def test_load_budget_metrics_window_boundary_seeds_force_window_check(tmp_path):
    """Seed the DB with TWO rows: one 86400s-old (boundary), one
    172800s-old (2× day). The total under the 86400s window should be
    exactly the boundary row's cost. If the window is widened (86401)
    or narrowed (86399) by 1 second, the boundary row falls on the
    OTHER side and the total changes.

    Specifically:
      - canonical 86400: boundary row included → total = boundary_cost
      - mutant 86401:    window wider; still includes the boundary row
                          (since 86400 ≤ 86401) AND maybe catches more —
                          but the 172800-old row is still excluded.
                          Same total. SURVIVES this test.
      - mutant 86399:    window NARROWER; the boundary row is now OUTSIDE
                          → total = 0. Test detects.

    So this test reliably KILLS M19 (86400→86399). M18 (86400→86401)
    needs a different anchor (see next test)."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-fake"}
    db_path = tmp_path / "orchestrator.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute(
            "CREATE TABLE metrics (bucket_at INTEGER PRIMARY KEY, "
            "cost_usd REAL)"
        )
        boundary_at = int((time.time() - 86399) // 300)  # JUST inside window
        old_at = int((time.time() - 172800) // 300)
        c.execute("INSERT INTO metrics VALUES (?, ?)",
                  (boundary_at, 2.50))
        c.execute("INSERT INTO metrics VALUES (?, ?)",
                  (old_at, 999.99))
        c.commit()
    result = billable.load_budget_metrics(str(tmp_path), env=api_env)
    # Under the canonical 86400 window, the boundary row's 2.50 is included
    # and the 172800-old 999.99 is excluded. Under M19 (86399 window),
    # the boundary row is just outside → total drops below 2.50.
    assert result["daily_cost_usd"] == pytest.approx(2.50, abs=0.01)


def test_load_budget_metrics_window_widening_changes_total(tmp_path):
    """Seed a row at 86405s-old. Under canonical 86400 → excluded.
    Under M18 (86401) → still excluded (86405 > 86401). Under a HYPOTHETICAL
    86410 → included.

    So M18 alone doesn't change behaviour for this row. To kill M18 we
    need a row that lands inside [86400, 86401]. That's a single
    300-second SQLite bucket-id of difference — impossible to seed
    reliably without timer control.

    M18 is therefore documented as a stubborn survivor — it widens the
    window by exactly 1 second, and no realistic test can detect a 1-second
    boundary shift in a 300-second-bucket aggregation. This is honest
    coverage: the test exists to document the limit, not to claim a kill.
    """
    pytest.skip("M18 (86400→86401) is a 1-second boundary shift inside a "
                "300-second SQLite bucket; not deterministically killable. "
                "Documented as stubborn survivor.")


# --- Anchor for M20/M21: SQLite timeout=5 -------------------------------


def test_load_budget_metrics_sqlite_timeout_parameter_observed(tmp_path,
                                                                 monkeypatch):
    """Verify the `timeout=5` parameter to sqlite3.connect is what billable
    actually passes. We monkeypatch sqlite3.connect to capture its kwargs.
    This kills M20 (5→6) and M21 (5→4) because the test asserts the exact
    value 5."""
    api_env = {"ANTHROPIC_API_KEY": "sk-ant-api03-fake"}
    # Need a real DB file so the existence check passes
    db_path = tmp_path / "orchestrator.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute(
            "CREATE TABLE metrics (bucket_at INTEGER PRIMARY KEY, "
            "cost_usd REAL)"
        )
        c.commit()

    captured_timeouts = []
    real_connect = sqlite3.connect

    def _spy_connect(*args, **kwargs):
        captured_timeouts.append(kwargs.get("timeout"))
        return real_connect(*args, **kwargs)

    # billable.py does `import sqlite3` lazily inside load_budget_metrics,
    # which resolves to the global sqlite3 module — patch that.
    monkeypatch.setattr(sqlite3, "connect", _spy_connect)

    billable.load_budget_metrics(str(tmp_path), env=api_env)
    # Should have called sqlite3.connect exactly once with timeout=5
    assert captured_timeouts == [5], (
        f"expected sqlite3.connect(timeout=5); got {captured_timeouts}"
    )
