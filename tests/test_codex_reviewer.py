"""Regression tests for orchestrator.codex_reviewer (Track R2).

The Codex CLI is a separate optional dependency the user installs
themselves (no API key required — local subscription auth). These tests
mock subprocess + shutil.which so they pass even when Codex isn't
installed.
"""
from __future__ import annotations

import os
import sys
import json
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import codex_reviewer as cr  # noqa: E402


# --- Availability ----------------------------------------------------------


def test_codex_available_returns_false_when_no_path():
    with patch("orchestrator.codex_reviewer.shutil.which", return_value=None):
        assert cr.codex_available() is False


def test_codex_available_returns_true_when_path_present():
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        assert cr.codex_available() is True


# --- run_codex_review ------------------------------------------------------


def test_run_codex_review_returns_unavailable_when_codex_missing():
    """When codex isn't on PATH, return verdict='codex_unavailable' and
    DO NOT shell out — no subprocess invocation."""
    with patch("orchestrator.codex_reviewer.shutil.which", return_value=None), \
         patch("subprocess.run") as mock_run:
        verdict = cr.run_codex_review(diff="diff --git ...",
                                        prompt_path=None)
        assert verdict.available is False
        assert verdict.verdict == "codex_unavailable"
        assert not mock_run.called


def test_run_codex_review_invokes_codex_when_available():
    """When codex IS on PATH, the helper runs it with the diff as input."""
    fake_result = MagicMock()
    fake_result.returncode = 0
    fake_result.stdout = "verdict: approve\nReason: looks fine."
    fake_result.stderr = ""
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"), \
         patch("subprocess.run", return_value=fake_result) as mock_run:
        verdict = cr.run_codex_review(diff="diff --git ...",
                                        prompt_path=None)
        assert verdict.available is True
        assert "approve" in verdict.verdict.lower()
        assert mock_run.called
        # Should pass the diff via stdin (input=...)
        call_kwargs = mock_run.call_args.kwargs
        assert "input" in call_kwargs


def test_run_codex_review_handles_nonzero_exit():
    """Codex returning non-zero is an error, not a verdict."""
    fake_result = MagicMock()
    fake_result.returncode = 1
    fake_result.stdout = ""
    fake_result.stderr = "auth required"
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"), \
         patch("subprocess.run", return_value=fake_result):
        verdict = cr.run_codex_review(diff="diff", prompt_path=None)
        assert verdict.error is not None
        assert "auth" in verdict.error.lower() or "error" in verdict.error.lower()


def test_run_codex_review_handles_timeout():
    """A hung Codex subprocess returns a timeout error, not a hang."""
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"), \
         patch("subprocess.run",
               side_effect=subprocess.TimeoutExpired(cmd="codex", timeout=60)):
        verdict = cr.run_codex_review(diff="diff", prompt_path=None,
                                        timeout=1)
        assert verdict.error is not None
        assert "timeout" in verdict.error.lower()


# --- Disagreement protocol ------------------------------------------------


def test_disagreement_none_when_both_pass():
    assert cr.disagreement_protocol("APPROVE", "approve") is None


def test_disagreement_none_when_both_fail():
    assert cr.disagreement_protocol("REQUEST_CHANGES", "reject") is None


def test_disagreement_detects_pass_vs_fail():
    reason = cr.disagreement_protocol("APPROVE", "reject")
    assert reason is not None
    assert "claude" in reason.lower() and "codex" in reason.lower()


def test_disagreement_skipped_when_codex_unavailable():
    """If Codex never ran, no disagreement is possible — protocol returns None."""
    assert cr.disagreement_protocol("APPROVE", "codex_unavailable") is None
    assert cr.disagreement_protocol("REQUEST_CHANGES", "codex_unavailable") is None


# --- ALERT.md emission -----------------------------------------------------


def test_write_alert_creates_file(tmp_path):
    alert = tmp_path / "ALERT.md"
    cr.write_alert("Claude=PASS, Codex=FAIL on diff abc1234", alert)
    assert alert.exists()
    text = alert.read_text()
    assert "ALERT" in text or "claude" in text.lower()
    assert "abc1234" in text


def test_write_alert_appends_when_existing(tmp_path):
    alert = tmp_path / "ALERT.md"
    alert.write_text("# pre-existing\n\nfoo\n")
    cr.write_alert("new disagreement", alert)
    text = alert.read_text()
    assert "pre-existing" in text  # preserved
    assert "new disagreement" in text  # appended
