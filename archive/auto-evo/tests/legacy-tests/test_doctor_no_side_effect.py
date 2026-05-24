"""Regression tests for FAIL-0009 (working-tree-dirty side-effect on
`reports/session-log.md`).

The empirical finding (Cycle 33): the doctor itself does NOT dirty
session-log.md; the cli-executor unit tests do, because they exercise
the real `_log()` writer against the real on-disk path. The fix is an
`AUTODEV_AUDIT_LOG_SUPPRESS` env-var gate that pytest's session-scoped
conftest fixture sets to "1" globally.

These tests pin both halves of the corrected diagnosis:
  1. The doctor was always innocent (snapshot survives a doctor run).
  2. The cli-executor unit tests no longer dirty the file when the
     suppress env var is set (which is the default for pytest in this
     repo).
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SESSION_LOG = REPO_ROOT / "reports" / "session-log.md"


def _snapshot() -> bytes:
    """Return the current bytes of reports/session-log.md, or b'' if
    the file is missing."""
    return SESSION_LOG.read_bytes() if SESSION_LOG.exists() else b""


def test_doctor_leaves_session_log_clean():
    """Running autodev_doctor.sh must NOT modify reports/session-log.md.

    The original FAILURES.md FAIL-0009 entry blamed the doctor; this
    test pins that the doctor is innocent (it was always pytest doing
    the writes).
    """
    before = _snapshot()
    r = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "autodev_doctor.sh")],
        capture_output=True, text=True, timeout=60, cwd=str(REPO_ROOT),
    )
    # Doctor may exit 0 or 1 depending on optional checks; the
    # invariant is content stability.
    after = _snapshot()
    assert before == after, (
        f"autodev_doctor.sh modified reports/session-log.md "
        f"(before {len(before)} bytes, after {len(after)} bytes). "
        f"FAIL-0009's working fix is AUTODEV_AUDIT_LOG_SUPPRESS in "
        f"autodev/executors/claude_code_cli.py:_log()."
    )


def test_cli_executor_tests_clean_with_suppress():
    """Running the cli-executor unit tests with
    AUTODEV_AUDIT_LOG_SUPPRESS=1 in the env must NOT modify
    reports/session-log.md.

    This is the actual fix: the executor's `_log()` checks the env
    var and returns early when set, preventing the test fixtures
    from leaking into the real audit log.
    """
    before = _snapshot()
    env = os.environ.copy()
    env["AUTODEV_AUDIT_LOG_SUPPRESS"] = "1"
    r = subprocess.run(
        [
            "python3", "-m", "pytest",
            "tests/test_autodev_claude_code_cli.py",
            "-q", "--no-header",
        ],
        capture_output=True, text=True, timeout=120,
        cwd=str(REPO_ROOT), env=env,
    )
    after = _snapshot()
    assert r.returncode == 0, (
        f"cli-executor tests failed: stdout={r.stdout[-500:]} "
        f"stderr={r.stderr[-500:]}"
    )
    assert before == after, (
        f"cli-executor tests modified reports/session-log.md despite "
        f"AUTODEV_AUDIT_LOG_SUPPRESS=1. Check that autodev/executors/"
        f"claude_code_cli.py:_log() honors the env var "
        f"(before {len(before)} bytes, after {len(after)} bytes)."
    )


def test_suppress_env_var_is_documented_in_executor():
    """The env-var gate must appear in the executor source so future
    maintainers can find it."""
    source = (REPO_ROOT / "autodev" / "executors" / "claude_code_cli.py").read_text()
    assert "AUTODEV_AUDIT_LOG_SUPPRESS" in source, (
        "AUTODEV_AUDIT_LOG_SUPPRESS env-var name must appear in "
        "autodev/executors/claude_code_cli.py so the suppression "
        "knob is discoverable"
    )


def test_pytest_conftest_sets_suppress_by_default():
    """The repo's tests/conftest.py must set
    AUTODEV_AUDIT_LOG_SUPPRESS=1 globally so all pytest runs are
    immune from this side-effect by default."""
    conftest = (REPO_ROOT / "tests" / "conftest.py").read_text()
    assert "AUTODEV_AUDIT_LOG_SUPPRESS" in conftest, (
        "tests/conftest.py must set AUTODEV_AUDIT_LOG_SUPPRESS=1 "
        "(session-scoped autouse fixture or top-level os.environ "
        "assignment)"
    )
