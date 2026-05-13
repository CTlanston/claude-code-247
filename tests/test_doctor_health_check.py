"""Cycle 38 — doctor surfaces health.json if present (read-only).

Per AUTODEV_L7_MASTER_PROMPT.md §10: doctor should call the health
script as part of pre-flight. To avoid re-introducing a FAIL-0009-
class side-effect (cycle 33's session-log.md fix), the doctor here
ONLY reads reports/health.json — it does not invoke the health
emitter and does not write any reports.

Tests pin both halves:
  - Doctor surfaces health when health.json is present.
  - Doctor stays read-only (no FAIL-0009 regression).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
DOCTOR = REPO_ROOT / "scripts" / "autodev_doctor.sh"


def _run_doctor_in_tmp_repo(tmp_path: Path, *,
                            health_json: dict | None = None,
                            include_doctor_only: bool = True) -> subprocess.CompletedProcess:
    """Copy just enough of the repo into tmp_path that doctor can run
    cleanly, optionally write a health.json into it, then invoke
    doctor and capture output.
    """
    # Doctor expects: reports/, tasks/, commands/, autodev/, etc.
    # The simplest path: run doctor in the REAL repo with our test
    # only checking the health surface. But the FAIL-0009 regression
    # guard needs the real tree. We compromise: test the doctor at
    # the REAL path but use the existing reports/health.json which
    # Cycle 37 already left in place.
    raise NotImplementedError("Use _run_doctor_real_repo for these tests")


def _run_doctor_real_repo() -> subprocess.CompletedProcess:
    """Run the doctor against the real repo. Used to verify the
    health surface + the FAIL-0009 regression guard."""
    return subprocess.run(
        ["bash", str(DOCTOR)],
        capture_output=True, text=True, timeout=60,
        cwd=str(REPO_ROOT),
    )


def _snapshot(path: Path) -> bytes:
    return path.read_bytes() if path.exists() else b""


# --- Doctor surfaces health.json -----------------------------------


def test_doctor_emits_health_line_when_json_present():
    """The real repo has reports/health.json (Cycle 37 emit).
    Doctor must print a line referencing the score + status."""
    health_path = REPO_ROOT / "reports" / "health.json"
    assert health_path.exists(), (
        "precondition: Cycle 37 should have left reports/health.json on "
        "disk; if you're running this on a fresh checkout, first run "
        "`bash scripts/autodev_health.sh`"
    )
    data = json.loads(health_path.read_text())
    expected_score = data["score"]
    expected_status = data["status"]

    r = _run_doctor_real_repo()
    # Doctor must surface the health line in its output
    assert "health" in r.stdout.lower(), (
        f"doctor output should mention 'health': {r.stdout[-500:]}"
    )
    # Must show the score
    assert str(expected_score) in r.stdout, (
        f"doctor output should include score={expected_score}: "
        f"{r.stdout[-500:]}"
    )
    # Must show the status
    assert expected_status in r.stdout, (
        f"doctor output should include status {expected_status!r}"
    )


def test_doctor_health_check_classifies_score_at_least_50_as_ok():
    """When health.json has score >= 50, the line should appear in
    the OK section (✓ marker), not the warning section (! marker)."""
    health_path = REPO_ROOT / "reports" / "health.json"
    data = json.loads(health_path.read_text())
    if data["score"] < 50:
        pytest.skip("real repo health is < 50; can't test the ok-path here")

    r = _run_doctor_real_repo()
    # Find the line that mentions 'health score'
    health_lines = [
        line for line in r.stdout.splitlines()
        if "health" in line.lower() and "score" in line.lower()
    ]
    assert health_lines, f"no health line found in: {r.stdout[-500:]}"
    # The ok-line marker in this codebase is "✓"; the warn-line is "!"
    assert any("✓" in line for line in health_lines), (
        f"health score >= 50 should appear with ✓ marker, got: "
        f"{health_lines}"
    )


# --- FAIL-0009 regression guard ------------------------------------


def test_doctor_does_not_modify_session_log_md():
    """Cycle 33's FAIL-0009 fix: doctor must NOT dirty
    reports/session-log.md. This test guards against regression
    after the Cycle 38 doctor extension."""
    session_log = REPO_ROOT / "reports" / "session-log.md"
    before = _snapshot(session_log)
    _run_doctor_real_repo()
    after = _snapshot(session_log)
    assert before == after, (
        f"FAIL-0009 regressed! Doctor modified reports/session-log.md "
        f"(before {len(before)} bytes, after {len(after)} bytes)."
    )


def test_doctor_does_not_modify_health_json():
    """The Cycle 38 doctor extension must be READ-ONLY against
    health.json. Doctor reads the score; it does NOT regenerate
    the file (that would re-introduce a dirty-tree side-effect
    similar to FAIL-0009)."""
    health_path = REPO_ROOT / "reports" / "health.json"
    if not health_path.exists():
        pytest.skip("reports/health.json not present in this checkout")
    before = _snapshot(health_path)
    _run_doctor_real_repo()
    after = _snapshot(health_path)
    assert before == after, (
        f"doctor modified reports/health.json — extension must be "
        f"read-only (before {len(before)} bytes, after {len(after)} "
        f"bytes). If you want the doctor to RE-COMPUTE health, that's "
        f"a separate cycle requiring careful FAIL-0009 analysis."
    )


def test_doctor_does_not_create_health_history_entries():
    """If the doctor were calling the health CLI internally, the
    history file would grow by one line per doctor run. Verify it
    doesn't."""
    history = REPO_ROOT / "reports" / "health.history.jsonl"
    if not history.exists():
        pytest.skip("reports/health.history.jsonl not present")
    before_lines = history.read_text().count("\n")
    _run_doctor_real_repo()
    after_lines = history.read_text().count("\n")
    assert before_lines == after_lines, (
        f"doctor caused health.history.jsonl to grow by "
        f"{after_lines - before_lines} lines — extension must be "
        f"read-only"
    )


# --- Doctor exit code stays clean ----------------------------------


def test_doctor_still_exits_0():
    """The doctor's existing exit semantics must not regress."""
    r = _run_doctor_real_repo()
    # The doctor exits with the number of failed REQUIRED checks.
    # 0 means all required pass; warns are allowed.
    assert r.returncode == 0, (
        f"doctor returncode={r.returncode}; stdout: {r.stdout[-300:]}"
    )


def test_doctor_pass_count_includes_health():
    """The Cycle 38 wire-in adds a new ok-line, so the summary
    pass count goes from 13 → 14 (when health is green)."""
    health_path = REPO_ROOT / "reports" / "health.json"
    if not health_path.exists() or json.loads(health_path.read_text())["score"] < 50:
        pytest.skip("only meaningful when health >= 50")
    r = _run_doctor_real_repo()
    # Doctor prints a summary line like "=== summary: N passed, F failed, W warned ==="
    import re
    m = re.search(r"summary:\s+(\d+)\s+passed", r.stdout)
    assert m, f"no summary line found: {r.stdout[-500:]}"
    pass_count = int(m.group(1))
    assert pass_count >= 14, (
        f"expected at least 14 passed (was 13 before this cycle); "
        f"got {pass_count}"
    )
