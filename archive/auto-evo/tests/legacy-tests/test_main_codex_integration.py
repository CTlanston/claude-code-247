"""Integration tests for codex_reviewer hooked into orchestrator/main.py (Track R3).

Tests verify that the codex review fires alongside the Claude reviewer
and behaves correctly across the five branches:
- codex agreement (verdicts match) → no ALERT
- codex disagreement (verdicts differ) → ALERT.md written
- codex unavailable (no PATH) → no crash, no ALERT
- codex skipped (budget cap refused) → no ALERT, normal flow
- codex error (codex returned non-zero) → logged, no ALERT, normal flow

The Claude reviewer's verdict remains decisive in all branches; codex
is an observer.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import main as orchestrator_main  # noqa: E402
import codex_reviewer as cr  # noqa: E402


# --- Helpers --------------------------------------------------------------


def _claude_review_result(verdict: str = "approve") -> dict:
    """Build a stub Claude reviewer subprocess result envelope."""
    return {
        "result": {
            "verdict": verdict,
            "summary": "stub claude review",
            "comments": [],
        },
        "in_tokens": 100, "out_tokens": 50, "cost_usd": 0.0,
    }


def _task_dict(branch: str = "shadow/issue-99") -> dict:
    """Stub task row from db.upsert_task."""
    import json
    return {
        "issue_id": 99,
        "branch": branch,
        "repo": "test/repo",
        "plan_json": json.dumps({"title": "stub plan"}),
        "review_rounds": 0,
    }


# --- Tests ----------------------------------------------------------------


def test_do_review_calls_codex_after_claude(tmp_path, monkeypatch):
    """The codex review fires after Claude returns."""
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH",
                        tmp_path / "ALERT.md", raising=False)
    claude_called = MagicMock(return_value=_claude_review_result("approve"))
    codex_called = MagicMock(return_value=cr.CodexReview(
        verdict="approve", tokens=1000, duration_s=10))

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh") as mock_gh, \
         patch.object(orchestrator_main, "db") as mock_db, \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                codex_called):
        mock_runner.run_role = claude_called
        mock_gh.open_pr.return_value = 123
        orchestrator_main._do_review(_task_dict())

    assert codex_called.called, "codex review was NOT invoked"


def test_do_review_writes_alert_on_disagreement(tmp_path, monkeypatch):
    """Claude=approve, Codex=reject → ALERT.md is written."""
    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)
    claude_result = _claude_review_result("approve")
    codex_result = cr.CodexReview(verdict="reject", tokens=10000,
                                    duration_s=20,
                                    findings=[
                                        cr.CodexFinding("high", "safety",
                                                         "SQL injection risk")
                                    ])

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh") as mock_gh, \
         patch.object(orchestrator_main, "db") as mock_db, \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_result):
        mock_runner.run_role.return_value = claude_result
        mock_gh.open_pr.return_value = 123
        orchestrator_main._do_review(_task_dict())

    assert alert.exists(), "ALERT.md was NOT written on disagreement"
    text = alert.read_text()
    assert "Claude" in text and "Codex" in text
    assert "approve" in text.lower()
    assert "reject" in text.lower()


def test_do_review_no_alert_when_codex_unavailable(tmp_path, monkeypatch):
    """Codex not on PATH → no crash, no ALERT, normal flow continues."""
    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)
    codex_result = cr.CodexReview(verdict="skipped",
                                    reason="codex_unavailable")

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh") as mock_gh, \
         patch.object(orchestrator_main, "db") as mock_db, \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_result):
        mock_runner.run_role.return_value = _claude_review_result("approve")
        mock_gh.open_pr.return_value = 123
        orchestrator_main._do_review(_task_dict())

    assert not alert.exists(), "ALERT.md written when codex unavailable"


def test_do_review_no_alert_on_codex_budget_skip(tmp_path, monkeypatch):
    """Codex skipped due to budget cap → no ALERT, normal flow."""
    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)
    codex_result = cr.CodexReview(verdict="skipped", reason="budget")

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh") as mock_gh, \
         patch.object(orchestrator_main, "db") as mock_db, \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_result):
        mock_runner.run_role.return_value = _claude_review_result("approve")
        mock_gh.open_pr.return_value = 123
        orchestrator_main._do_review(_task_dict())

    assert not alert.exists()


def test_do_review_no_alert_on_codex_error(tmp_path, monkeypatch):
    """Codex returned error → logged, no ALERT, normal flow."""
    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)
    codex_result = cr.CodexReview(verdict="error", reason="codex_exit=1")

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh") as mock_gh, \
         patch.object(orchestrator_main, "db") as mock_db, \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_result):
        mock_runner.run_role.return_value = _claude_review_result("approve")
        mock_gh.open_pr.return_value = 123
        orchestrator_main._do_review(_task_dict())

    assert not alert.exists()


def test_do_review_codex_exception_does_not_break_flow(tmp_path, monkeypatch):
    """If codex_reviewer itself raises, _do_review still completes the
    normal Claude-driven flow. Codex is enhancement, not dependency."""
    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)

    def raise_codex(*args, **kwargs):
        raise RuntimeError("codex blew up unexpectedly")

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh") as mock_gh, \
         patch.object(orchestrator_main, "db") as mock_db, \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                side_effect=raise_codex):
        mock_runner.run_role.return_value = _claude_review_result("approve")
        mock_gh.open_pr.return_value = 123
        # The call should NOT raise
        orchestrator_main._do_review(_task_dict())

    assert not alert.exists()


def test_do_review_writes_codex_review_log(tmp_path, monkeypatch):
    """Each codex review is appended to reports/codex-reviews.jsonl
    (trend-tracking parallel to codex-spend.jsonl)."""
    log_path = tmp_path / "codex-reviews.jsonl"
    monkeypatch.setattr(orchestrator_main, "CODEX_REVIEWS_LOG", log_path,
                        raising=False)
    codex_result = cr.CodexReview(verdict="approve", tokens=5000,
                                    duration_s=15)

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh") as mock_gh, \
         patch.object(orchestrator_main, "db") as mock_db, \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_result):
        mock_runner.run_role.return_value = _claude_review_result("approve")
        mock_gh.open_pr.return_value = 123
        orchestrator_main._do_review(_task_dict())

    assert log_path.exists()
    import json
    lines = [json.loads(l) for l in log_path.read_text().splitlines() if l]
    assert len(lines) == 1
    assert lines[0]["claude_verdict"] == "approve"
    assert lines[0]["codex_verdict"] == "approve"
    assert lines[0]["disagreement"] is False
    assert lines[0]["codex_tokens"] == 5000
