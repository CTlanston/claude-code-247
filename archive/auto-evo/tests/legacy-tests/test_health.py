"""Track H1 — orchestrator/health.py (Cycle 37).

The wake script (scripts/autodev_continuous_cycle.sh) already reads
reports/health.json and skips dispatch when score < 50. This module
makes that input data real. Per AUTODEV_L7_MASTER_PROMPT.md §10.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from orchestrator.health import (  # noqa: E402
    HealthSignals,
    compute_score,
    compute_signals,
    health_status,
    write_reports,
)


# --- Public API surface ----------------------------------------------


def test_module_exports_required_names():
    """All four public names must be importable."""
    from orchestrator import health as h
    for name in ("HealthSignals", "compute_signals", "compute_score",
                 "write_reports", "health_status"):
        assert hasattr(h, name), f"orchestrator.health.{name} missing"


# --- compute_score behavior ------------------------------------------


def _max_signals() -> HealthSignals:
    """Build a signals object that should yield a perfect 100."""
    return HealthSignals(
        test_status="PASS",
        lint_typecheck="NO_DATA",        # NO_DATA → full allocation
        recent_failure_rate=0.0,
        stuck_issue_count=0,
        guardian_pauses_last_24h=0,
        flaky_test_signs="NO_DATA",      # NO_DATA → full allocation
        large_diff_signs=0,
        untracked_file_risk="clean",
        cost_budget_remaining_pct=100.0,
    )


def _min_signals() -> HealthSignals:
    """Build a signals object that should yield ~0."""
    return HealthSignals(
        test_status="FAIL",
        lint_typecheck="FAIL",
        recent_failure_rate=1.0,
        stuck_issue_count=5,
        guardian_pauses_last_24h=5,
        flaky_test_signs="3+",
        large_diff_signs=5,
        untracked_file_risk="suspicious",
        cost_budget_remaining_pct=0.0,
    )


def test_max_signals_score_100():
    assert compute_score(_max_signals()) == 100


def test_min_signals_score_low():
    """A maximally bad set of signals should score below the
    degraded threshold (50)."""
    score = compute_score(_min_signals())
    assert 0 <= score < 50, f"min signals should be < 50 (red), got {score}"


def test_no_data_signals_dont_penalize():
    """If a signal is NO_DATA, its slot contributes the FULL
    allocation. Otherwise the health score would punish the
    system for not-yet-implemented signals."""
    s = HealthSignals(
        test_status="NO_DATA",          # 30 pts
        lint_typecheck="NO_DATA",       # 10 pts
        recent_failure_rate=None,       # 15 pts (None = NO_DATA)
        stuck_issue_count=None,         # 10 pts
        guardian_pauses_last_24h=None,  # 10 pts
        flaky_test_signs="NO_DATA",     # 5 pts
        large_diff_signs=None,          # 5 pts
        untracked_file_risk="NO_DATA",  # 5 pts
        cost_budget_remaining_pct=None, # 10 pts
    )
    assert compute_score(s) == 100


def test_test_status_pass_vs_fail_difference():
    """test_status flipping from PASS to FAIL should drop the
    score by exactly 30 points (§10 allocation)."""
    pass_s = _max_signals()
    fail_s = _max_signals()
    fail_s.test_status = "FAIL"
    assert compute_score(pass_s) - compute_score(fail_s) == 30


# --- health_status threshold mapping --------------------------------


def test_health_status_thresholds():
    """Per §10:
       90-100 green | 70-89 usable | 50-69 degraded | <50 red"""
    assert health_status(100) == "green"
    assert health_status(95) == "green"
    assert health_status(90) == "green"
    assert health_status(89) == "usable"
    assert health_status(70) == "usable"
    assert health_status(69) == "degraded"
    assert health_status(50) == "degraded"
    assert health_status(49) == "red"
    assert health_status(0) == "red"


# --- compute_signals (disk-state gathering) -------------------------


def test_compute_signals_clean_repo_pass(tmp_path):
    """A bare tmp repo with no FAILURES, no BLOCKED, no .env should
    classify as a healthy state."""
    (tmp_path / "tasks").mkdir()
    (tmp_path / "reports").mkdir()
    # Initialize a real git repo so the git-based signals work
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=T",
         "commit", "--allow-empty", "-m", "seed"],
        cwd=tmp_path, check=True, capture_output=True,
    )
    signals = compute_signals(tmp_path)
    # Untracked-risk should be clean (no .env, no secrets)
    assert signals.untracked_file_risk in ("clean", "NO_DATA")


def test_compute_signals_suspicious_untracked(tmp_path):
    """A tmp repo with a .env-like untracked file should flag
    untracked_file_risk='suspicious'."""
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=T",
         "commit", "--allow-empty", "-m", "seed"],
        cwd=tmp_path, check=True, capture_output=True,
    )
    (tmp_path / ".env").write_text("SECRET=oops\n")
    signals = compute_signals(tmp_path)
    assert signals.untracked_file_risk == "suspicious", (
        f"expected suspicious, got {signals.untracked_file_risk}"
    )


def test_compute_signals_recent_failure_rate_from_history(tmp_path):
    """recent_failure_rate should read reports/cycle-history.jsonl
    and compute pass-vs-fail ratio over the last N entries."""
    (tmp_path / "reports").mkdir()
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=T",
         "commit", "--allow-empty", "-m", "seed"],
        cwd=tmp_path, check=True, capture_output=True,
    )
    # 10 entries: 7 deadlock=False (PASS), 3 deadlock=True (treated as fail)
    history = tmp_path / "reports" / "cycle-history.jsonl"
    with history.open("w") as f:
        for i in range(7):
            f.write(json.dumps({
                "cycle_id": f"20260513-{i:06d}",
                "deadlock": False, "streak_after": i + 1,
            }) + "\n")
        for i in range(3):
            f.write(json.dumps({
                "cycle_id": f"20260513-bad{i:03d}",
                "deadlock": True, "streak_after": 0,
            }) + "\n")
    signals = compute_signals(tmp_path)
    # 3/10 = 0.30 — should round to a rate between 0.2 and 0.4
    assert signals.recent_failure_rate is not None
    assert 0.20 <= signals.recent_failure_rate <= 0.40


# --- write_reports + history ----------------------------------------


def test_write_reports_creates_all_three_files(tmp_path):
    (tmp_path / "reports").mkdir()
    signals = _max_signals()
    score = compute_score(signals)
    write_reports(score, signals, tmp_path)
    assert (tmp_path / "reports" / "health.json").exists()
    assert (tmp_path / "reports" / "health.md").exists()
    assert (tmp_path / "reports" / "health.history.jsonl").exists()


def test_write_reports_history_appends_not_overwrites(tmp_path):
    """The history file is append-only — a second call should add
    a line, not replace."""
    (tmp_path / "reports").mkdir()
    signals = _max_signals()
    score = compute_score(signals)
    write_reports(score, signals, tmp_path)
    write_reports(score, signals, tmp_path)
    write_reports(score, signals, tmp_path)
    history = tmp_path / "reports" / "health.history.jsonl"
    lines = [l for l in history.read_text().splitlines() if l.strip()]
    assert len(lines) == 3


def test_health_json_has_required_schema(tmp_path):
    """The launchd wake script greps for 'score' in health.json
    — that key MUST be present and numeric."""
    (tmp_path / "reports").mkdir()
    signals = _max_signals()
    score = compute_score(signals)
    write_reports(score, signals, tmp_path)
    data = json.loads((tmp_path / "reports" / "health.json").read_text())
    assert "score" in data
    assert isinstance(data["score"], (int, float))
    assert 0 <= data["score"] <= 100
    # Also the status field
    assert "status" in data
    assert data["status"] in {"green", "usable", "degraded", "red"}


def test_health_md_human_readable(tmp_path):
    """The .md emit should contain the score + a per-signal table."""
    (tmp_path / "reports").mkdir()
    signals = _max_signals()
    score = compute_score(signals)
    write_reports(score, signals, tmp_path)
    md = (tmp_path / "reports" / "health.md").read_text()
    assert "Score" in md or "score" in md.lower()
    assert "test_status" in md
    assert "untracked_file_risk" in md


# --- CLI entry point smoke ------------------------------------------


def test_module_cli_writes_health_json(tmp_path):
    """`python3 orchestrator/health.py --repo <tmp>` writes a real
    health.json under <tmp>/reports/."""
    (tmp_path / "reports").mkdir()
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=T",
         "commit", "--allow-empty", "-m", "seed"],
        cwd=tmp_path, check=True, capture_output=True,
    )
    r = subprocess.run(
        [sys.executable, str(REPO_ROOT / "orchestrator" / "health.py"),
         "--repo", str(tmp_path)],
        capture_output=True, text=True, timeout=60,
    )
    assert r.returncode == 0, f"stderr: {r.stderr}"
    assert (tmp_path / "reports" / "health.json").exists()
    data = json.loads((tmp_path / "reports" / "health.json").read_text())
    assert "score" in data


def test_shell_wrapper_executable():
    """scripts/autodev_health.sh exists and is executable."""
    import os
    wrapper = REPO_ROOT / "scripts" / "autodev_health.sh"
    assert wrapper.exists()
    assert os.access(wrapper, os.X_OK)
