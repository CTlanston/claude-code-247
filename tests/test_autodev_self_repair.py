"""Regression tests for scripts/autodev_self_repair.sh (Cycle δ).

The self-repair handler is invoked by the continuous-cycle wake script
when 3 consecutive failures share the same signature. Its job:
(a) append one line to reports/self-repair.log, (b) write BLOCKED.md
with the failure signature + cycle log tail + operator actions.

Pattern-matching against known failure types is OUT of scope for this
cycle — see ADR-0012 for the deferred-scope reasoning.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "autodev_self_repair.sh"


def _run(args, *, tmp_path: Path,
         extra_env: dict | None = None) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["AUTODEV_REPO_ROOT"] = str(tmp_path)
    if extra_env:
        env.update({k: str(v) for k, v in extra_env.items()})
    return subprocess.run(
        [str(SCRIPT), *args],
        capture_output=True, text=True, env=env, timeout=15,
    )


def _seed_log(tmp_path: Path, content: str) -> Path:
    """Create a fake cycle log inside tmp_path/reports/runs/."""
    (tmp_path / "reports" / "runs").mkdir(parents=True, exist_ok=True)
    log = tmp_path / "reports" / "runs" / "fake-cycle.log"
    log.write_text(content)
    return log


# --- Existence / executable ---------------------------------------------


def test_script_exists():
    assert SCRIPT.exists()


def test_script_executable():
    assert os.access(SCRIPT, os.X_OK)


# --- Trigger output ----------------------------------------------------


def test_writes_self_repair_log_entry(tmp_path):
    """One invocation appends one line to reports/self-repair.log."""
    log_path = _seed_log(tmp_path, "line1\nline2\nERROR: boom\n")
    r = _run([str(log_path), "deadbeef" * 8], tmp_path=tmp_path)
    assert r.returncode == 0, r.stderr
    repair_log = tmp_path / "reports" / "self-repair.log"
    assert repair_log.exists(), "self-repair.log should be created"
    text = repair_log.read_text()
    assert "trigger" in text
    assert "deadbeefdeadbeef" in text or "deadbeef" in text


def test_writes_blocked_md_with_signature(tmp_path):
    """BLOCKED.md is written, contains the signature + log tail +
    three operator actions."""
    log_path = _seed_log(
        tmp_path,
        "line above tail\n" * 30 + "TAIL_MARKER_X\nERROR: boom\n",
    )
    r = _run([str(log_path), "cafef00d" * 8], tmp_path=tmp_path)
    assert r.returncode == 0
    blocked = tmp_path / "BLOCKED.md"
    assert blocked.exists()
    body = blocked.read_text()
    assert "cafef00dcafef00d" in body, "signature missing from BLOCKED.md"
    assert "TAIL_MARKER_X" in body, (
        "cycle log tail should appear in BLOCKED.md"
    )
    # Three plausible operator actions
    assert "1." in body and "2." in body and "3." in body
    assert "autodev_doctor" in body, (
        "BLOCKED.md should suggest running doctor as an operator action"
    )
    assert "rm BLOCKED.md" in body, (
        "BLOCKED.md should tell the operator how to clear it"
    )


def test_missing_cycle_log_path_exits_nonzero(tmp_path):
    """If the wake script invokes self-repair with a bogus path, exit
    nonzero and DO NOT write BLOCKED.md (we don't want to fabricate
    failure context)."""
    r = _run(["/nonexistent/path/cycle.log", "x" * 16], tmp_path=tmp_path)
    assert r.returncode != 0
    assert not (tmp_path / "BLOCKED.md").exists()


def test_repeated_invocations_append_not_overwrite_log(tmp_path):
    """If the operator hasn't resolved BLOCKED.md and another self-repair
    invocation fires (e.g., the trigger fires every N wakes after the
    first trip), reports/self-repair.log accumulates entries rather
    than getting truncated."""
    log_path = _seed_log(tmp_path, "ERROR: first\n")
    r1 = _run([str(log_path), "sig-A" * 12], tmp_path=tmp_path)
    assert r1.returncode == 0
    log_path.write_text("ERROR: second\n")
    r2 = _run([str(log_path), "sig-B" * 12], tmp_path=tmp_path)
    assert r2.returncode == 0
    text = (tmp_path / "reports" / "self-repair.log").read_text()
    assert text.count("trigger") == 2, (
        f"two invocations should produce two log lines; got:\n{text}"
    )


def test_blocked_md_includes_path_to_cycle_log(tmp_path):
    """The operator needs to know which log to inspect; the BLOCKED.md
    should name the cycle log path explicitly."""
    log_path = _seed_log(tmp_path, "line\n" * 5 + "ERROR: boom\n")
    r = _run([str(log_path), "f00d" * 16], tmp_path=tmp_path)
    assert r.returncode == 0
    body = (tmp_path / "BLOCKED.md").read_text()
    assert str(log_path) in body, (
        f"BLOCKED.md should name the cycle log path; got body:\n{body[:600]}"
    )
