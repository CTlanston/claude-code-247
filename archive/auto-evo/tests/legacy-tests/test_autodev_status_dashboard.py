"""Regression tests for scripts/autodev_status_dashboard.sh (Cycle 28).

The dashboard is a read-only one-screen operator status command. All
tests run with AUTODEV_DASHBOARD_DRY_RUN=1 so the real launchctl is
never queried. Each test seeds a tmp_path repo with just the files
that section reads, runs the dashboard, and asserts the section's
output.
"""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "autodev_status_dashboard.sh"


def _seed(tmp_path: Path, *,
          level_overall: int | None = 4,
          per_dim: dict | None = None,
          streak: int | None = None,
          changelog_lines: list | None = None,
          stop_files: dict | None = None,
          launchd_log: str | None = None,
          rate_limit_until: int | None = None) -> None:
    """Lay down just the files relevant to whichever section the test
    is checking. Defaults give a clean 'cycle dispatch will fire' state."""
    (tmp_path / "reports").mkdir(parents=True, exist_ok=True)
    (tmp_path / "reports" / "runs").mkdir(parents=True, exist_ok=True)

    if level_overall is not None or per_dim is not None:
        lines = [
            "# LEVEL.md (generated)\n",
            "Overall L = min across all dimensions.\n",
        ]
        if per_dim is None:
            per_dim = {"M": 7, "S": 7, "R": 7, "C": 4, "T": 7, "E": 7}
        for dim in "MSRCTE":
            v = per_dim.get(dim, 7)
            lines.append(f"{dim} {v} | evidence: stub\n")
        lines.append(f"\nOverall L = {level_overall}\n")
        (tmp_path / "LEVEL.md").write_text("".join(lines))

    if streak is not None:
        (tmp_path / "reports" / "zero-deadlock-streak.txt").write_text(
            f"{streak}\n"
        )

    if changelog_lines is not None:
        (tmp_path / "CHANGELOG.md").write_text("\n".join(changelog_lines) + "\n")

    if stop_files:
        for key, val in stop_files.items():
            if key == "AUTODEV_DONE":
                (tmp_path / "reports" / "AUTODEV_DONE.md").write_text(val)
            elif key == "STOPSWITCH":
                (tmp_path / "reports" / "STOPSWITCH").write_text(val)
            elif key == "BLOCKED":
                (tmp_path / "BLOCKED.md").write_text(val)

    if launchd_log is not None:
        (tmp_path / "reports" / "runs" / "launchd.log").write_text(launchd_log)

    if rate_limit_until is not None:
        (tmp_path / "reports" / "quota-rate-limit-until.ts").write_text(
            f"{rate_limit_until}\n"
        )


def _run(tmp_path: Path) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["AUTODEV_REPO_ROOT"] = str(tmp_path)
    env["AUTODEV_DASHBOARD_DRY_RUN"] = "1"
    return subprocess.run(
        [str(SCRIPT)], capture_output=True, text=True, env=env, timeout=15,
    )


# --- Existence / executable / always-exits-0 --------------------------


def test_script_exists():
    assert SCRIPT.exists()


def test_script_executable():
    assert os.access(SCRIPT, os.X_OK)


def test_bare_run_exits_0(tmp_path):
    """Even on an empty repo, the dashboard should exit 0."""
    r = _run(tmp_path)
    assert r.returncode == 0, r.stderr


# --- Section headers always present -----------------------------------


def test_emits_overall_level_header(tmp_path):
    r = _run(tmp_path)
    assert "Overall Level" in r.stdout


def test_emits_per_dim_header(tmp_path):
    r = _run(tmp_path)
    assert "Per-dim" in r.stdout


def test_emits_c_streak_header(tmp_path):
    r = _run(tmp_path)
    assert "C Streak" in r.stdout


def test_emits_last_5_cycles_header(tmp_path):
    r = _run(tmp_path)
    assert "Last 5 cycles" in r.stdout


def test_emits_stop_conditions_header(tmp_path):
    r = _run(tmp_path)
    assert "Stop conditions" in r.stdout


def test_emits_last_wake_events_header(tmp_path):
    r = _run(tmp_path)
    assert "wake events" in r.stdout.lower()


def test_emits_launchctl_header(tmp_path):
    r = _run(tmp_path)
    assert "launchctl" in r.stdout.lower()


# --- Overall Level + Per-dim from LEVEL.md ----------------------------


def test_reads_overall_level_from_level_md(tmp_path):
    _seed(tmp_path, level_overall=4)
    r = _run(tmp_path)
    assert "Overall L = 4" in r.stdout


def test_overall_level_missing_level_md(tmp_path):
    """If LEVEL.md is missing entirely, surface a helpful hint."""
    r = _run(tmp_path)
    assert "LEVEL.md missing" in r.stdout


def test_per_dim_table_emitted(tmp_path):
    _seed(tmp_path, per_dim={"M": 7, "S": 7, "R": 7, "C": 4, "T": 6, "E": 5})
    r = _run(tmp_path)
    # All 6 dims should appear in the Per-dim section
    for dim in "MSRCTE":
        assert f"{dim} " in r.stdout, f"dim {dim} missing from output"
    assert "T 6" in r.stdout
    assert "E 5" in r.stdout


# --- C Streak section -------------------------------------------------


def test_streak_section_reads_zero_deadlock_streak_file(tmp_path):
    _seed(tmp_path, streak=7)
    r = _run(tmp_path)
    assert "current=7/30" in r.stdout
    assert "23 more cycles to C-L5" in r.stdout


def test_streak_section_zero(tmp_path):
    _seed(tmp_path, streak=0)
    r = _run(tmp_path)
    assert "current=0/30" in r.stdout
    assert "30 more cycles" in r.stdout


def test_streak_section_at_or_above_target(tmp_path):
    """When streak >= 30, remaining should clamp to 0 (not negative)."""
    _seed(tmp_path, streak=33)
    r = _run(tmp_path)
    assert "current=33/30" in r.stdout
    assert "0 more cycles" in r.stdout


def test_streak_section_no_file(tmp_path):
    r = _run(tmp_path)
    assert "no streak yet" in r.stdout.lower() or "missing" in r.stdout.lower()


# --- Last 5 cycles from CHANGELOG --------------------------------------


def test_tails_changelog(tmp_path):
    lines = [f"line-{i} | dim | summary | PASS" for i in range(10)]
    _seed(tmp_path, changelog_lines=lines)
    r = _run(tmp_path)
    # Last 5 (5 through 9) should appear
    for i in range(5, 10):
        assert f"line-{i}" in r.stdout, f"expected last-5 line {i}"
    # First 5 should NOT appear
    assert "line-0" not in r.stdout, "tail -5 should drop line-0"


# --- Stop conditions --------------------------------------------------


def test_stop_conditions_no_signals(tmp_path):
    r = _run(tmp_path)
    assert "none active" in r.stdout.lower()


def test_stop_conditions_stopswitch(tmp_path):
    _seed(tmp_path, stop_files={"STOPSWITCH": "halt\n"})
    r = _run(tmp_path)
    assert "STOPSWITCH" in r.stdout
    assert "human halt" in r.stdout.lower()


def test_stop_conditions_blocked(tmp_path):
    _seed(tmp_path, stop_files={"BLOCKED": "blocked\n"})
    r = _run(tmp_path)
    assert "BLOCKED.md" in r.stdout


def test_stop_conditions_autodev_done(tmp_path):
    _seed(tmp_path, stop_files={"AUTODEV_DONE": "done\n"})
    r = _run(tmp_path)
    assert "AUTODEV_DONE.md" in r.stdout
    assert "mission complete" in r.stdout.lower()


def test_stop_conditions_active_rate_limit(tmp_path):
    """Rate-limit in the future is reported with minutes remaining."""
    future = int(time.time() + 3600)
    _seed(tmp_path, rate_limit_until=future)
    r = _run(tmp_path)
    assert "rate-limit" in r.stdout.lower() or "quota-rate-limit" in r.stdout.lower()


def test_stop_conditions_expired_rate_limit_not_reported(tmp_path):
    """Rate-limit in the past should NOT be reported as active."""
    past = int(time.time() - 60)
    _seed(tmp_path, rate_limit_until=past)
    r = _run(tmp_path)
    # No "active" rate-limit; should fall back to "none active"
    # The file exists but the dashboard checks the timestamp
    assert "min remaining" not in r.stdout


# --- Last wake events ---------------------------------------------------


def test_no_launchd_log_yet(tmp_path):
    r = _run(tmp_path)
    assert "no launchd log yet" in r.stdout or "missing" in r.stdout


def test_tails_launchd_log(tmp_path):
    log = "\n".join([f"event-{i}" for i in range(10)]) + "\n"
    _seed(tmp_path, launchd_log=log)
    r = _run(tmp_path)
    # Last 5 events (5 through 9) should appear
    for i in range(5, 10):
        assert f"event-{i}" in r.stdout
    assert "event-0" not in r.stdout


# --- launchctl section in dry-run ---------------------------------------


def test_launchctl_dry_run_skipped(tmp_path):
    """In dry-run, the launchctl section should say so explicitly."""
    r = _run(tmp_path)
    assert "[dry-run] skipped" in r.stdout


# --- Doctor wire-up -----------------------------------------------------


def test_doctor_checks_dashboard():
    """autodev_doctor.sh should include a check for the dashboard
    being present + executable."""
    doctor = (REPO_ROOT / "scripts" / "autodev_doctor.sh").read_text()
    assert "autodev_status_dashboard.sh" in doctor, (
        "doctor must check for the dashboard script (Cycle 28 wire-up)"
    )
