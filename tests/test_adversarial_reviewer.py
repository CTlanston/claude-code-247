"""Tests for orchestrator.adversarial_reviewer + role prompt (Track R6).

The adversarial reviewer is a single-purpose Claude Code subagent that
asks one question: "how does this change break in production?"
It runs as the 3rd reviewer after Claude main + Codex, observer-only.

Tests stub `runner.run_role` so no real Claude subagent fires in CI.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import adversarial_reviewer as ar  # noqa: E402


# --- Role prompt --------------------------------------------------------


def test_adversarial_role_prompt_file_exists():
    """The Claude Code subagent reads its system prompt from this file."""
    role_md = REPO_ROOT / "runner" / "roles" / "adversarial_reviewer.md"
    assert role_md.exists(), f"missing role prompt: {role_md}"


def test_adversarial_role_prompt_is_single_purpose():
    """The prompt should explicitly say 'find ways this change breaks
    in production' — that's the single-purpose contract."""
    role_md = REPO_ROOT / "runner" / "roles" / "adversarial_reviewer.md"
    text = role_md.read_text().lower()
    assert "adversarial_reviewer" in text or "adversarial reviewer" in text
    assert ("production" in text and "break" in text) or "fail" in text


# --- Adapter API --------------------------------------------------------


def test_run_adversarial_review_returns_dataclass():
    """The adapter returns an AdversarialReview with the expected fields."""
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.return_value = {
            "result": {
                "verdict": "approve",
                "summary": "no production issues found",
                "comments": [],
            },
        }
        review = ar.run_adversarial_review(
            task={"issue_id": 42, "branch": "shadow/issue-42",
                  "repo": "test/r"},
            issue_id=42,
        )
    assert isinstance(review, ar.AdversarialReview)
    assert review.verdict in ("approve", "reject", "request_changes",
                               "skipped", "error", "unknown")
    assert review.source == "adversarial"


def test_run_adversarial_review_parses_approve(tmp_path):
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.return_value = {
            "result": {
                "verdict": "approve",
                "summary": "no issues",
                "comments": [],
            },
        }
        review = ar.run_adversarial_review(
            task={"issue_id": 1, "branch": "b", "repo": "r"},
            issue_id=1,
        )
    assert review.verdict == "approve"


def test_run_adversarial_review_parses_reject_with_findings():
    """A reject verdict with structured comments should produce findings."""
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.return_value = {
            "result": {
                "verdict": "reject",
                "summary": "concurrency bug",
                "comments": [
                    {"category": "race", "msg": "TOCTOU on db write"},
                    {"category": "leak", "msg": "fd not closed on error"},
                ],
            },
        }
        review = ar.run_adversarial_review(
            task={"issue_id": 1, "branch": "b", "repo": "r"},
            issue_id=1,
        )
    assert review.verdict == "reject"
    assert len(review.findings) == 2
    # Findings preserve category + message
    cats = {f.category for f in review.findings}
    assert "race" in cats and "leak" in cats


def test_run_adversarial_review_returns_error_on_runner_exception():
    """If `runner.run_role` raises, the adapter returns verdict=error
    rather than propagating."""
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.side_effect = RuntimeError("subagent died")
        review = ar.run_adversarial_review(
            task={"issue_id": 1, "branch": "b", "repo": "r"},
            issue_id=1,
        )
    assert review.verdict == "error"
    assert "subagent died" in (review.reason or "")


def test_run_adversarial_review_handles_missing_verdict():
    """If the subagent returns a dict without `verdict`, default to unknown."""
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.return_value = {"result": {}}
        review = ar.run_adversarial_review(
            task={"issue_id": 1, "branch": "b", "repo": "r"},
            issue_id=1,
        )
    assert review.verdict == "unknown"


def test_to_dict_schema():
    """AdversarialReview.to_dict produces the expected schema for logs."""
    review = ar.AdversarialReview(
        verdict="approve", summary="ok", findings=[],
    )
    d = review.to_dict()
    for key in ("source", "verdict", "summary", "findings", "reason"):
        assert key in d
    assert d["source"] == "adversarial"


# --- Integration with _do_review --------------------------------------


def test_do_review_calls_adversarial_after_codex(tmp_path, monkeypatch):
    """orchestrator/main.py:_do_review now runs adversarial AFTER Codex."""
    sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
    import main as orchestrator_main
    import codex_reviewer

    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "CODEX_REVIEWS_LOG",
                        tmp_path / "codex-reviews.jsonl",
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "ADVERSARIAL_REVIEWS_LOG",
                        tmp_path / "adv-reviews.jsonl",
                        raising=False)

    claude_result = {
        "result": {"verdict": "approve", "summary": "ok", "comments": []},
        "in_tokens": 0, "out_tokens": 0, "cost_usd": 0,
    }
    codex_result = codex_reviewer.CodexReview(verdict="approve", tokens=10)
    adv_result = ar.AdversarialReview(verdict="approve", summary="no issues")
    adv_called = MagicMock(return_value=adv_result)

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh"), \
         patch.object(orchestrator_main, "db"), \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_result), \
         patch("orchestrator.main.adversarial_reviewer.run_adversarial_review",
                adv_called):
        mock_runner.run_role.return_value = claude_result
        orchestrator_main._do_review({
            "issue_id": 99, "branch": "shadow/issue-99", "repo": "r",
            "plan_json": "{}", "review_rounds": 0,
        })

    assert adv_called.called, "adversarial review was NOT invoked"


def test_do_review_writes_alert_on_adversarial_disagreement(tmp_path,
                                                              monkeypatch):
    """Claude=APPROVE + Adversarial=REJECT → ALERT.md written."""
    sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
    import main as orchestrator_main
    import codex_reviewer

    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "CODEX_REVIEWS_LOG",
                        tmp_path / "codex-reviews.jsonl",
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "ADVERSARIAL_REVIEWS_LOG",
                        tmp_path / "adv-reviews.jsonl",
                        raising=False)

    claude_result = {
        "result": {"verdict": "approve", "summary": "ok", "comments": []},
        "in_tokens": 0, "out_tokens": 0, "cost_usd": 0,
    }
    codex_result = codex_reviewer.CodexReview(verdict="approve", tokens=10)
    adv_result = ar.AdversarialReview(
        verdict="reject", summary="race condition",
        findings=[ar.AdversarialFinding(
            category="race", message="TOCTOU on db write",
        )],
    )

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh"), \
         patch.object(orchestrator_main, "db"), \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_result), \
         patch("orchestrator.main.adversarial_reviewer.run_adversarial_review",
                return_value=adv_result):
        mock_runner.run_role.return_value = claude_result
        orchestrator_main._do_review({
            "issue_id": 99, "branch": "shadow/issue-99", "repo": "r",
            "plan_json": "{}", "review_rounds": 0,
        })

    assert alert.exists(), "ALERT.md was NOT written on adversarial disagreement"
    text = alert.read_text().lower()
    assert "adversarial" in text or "race" in text


def test_do_review_adversarial_exception_does_not_break_flow(tmp_path,
                                                               monkeypatch):
    """Even if the adversarial reviewer raises, _do_review still completes
    via the Claude-driven path. Adversarial is enhancement, not dependency."""
    sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
    import main as orchestrator_main
    import codex_reviewer

    alert = tmp_path / "ALERT.md"
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH", alert,
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "CODEX_REVIEWS_LOG",
                        tmp_path / "codex-reviews.jsonl",
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "ADVERSARIAL_REVIEWS_LOG",
                        tmp_path / "adv-reviews.jsonl",
                        raising=False)

    def adv_raises(*a, **k):
        raise RuntimeError("adv blew up")

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh"), \
         patch.object(orchestrator_main, "db"), \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_reviewer.CodexReview(verdict="approve")), \
         patch("orchestrator.main.adversarial_reviewer.run_adversarial_review",
                side_effect=adv_raises):
        mock_runner.run_role.return_value = {
            "result": {"verdict": "approve", "summary": "ok", "comments": []},
            "in_tokens": 0, "out_tokens": 0, "cost_usd": 0,
        }
        # The call should NOT raise
        orchestrator_main._do_review({
            "issue_id": 99, "branch": "shadow/issue-99", "repo": "r",
            "plan_json": "{}", "review_rounds": 0,
        })

    assert not alert.exists()


def test_do_review_logs_adversarial_review(tmp_path, monkeypatch):
    """Each adversarial pass appends to reports/adversarial-reviews.jsonl."""
    sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
    import main as orchestrator_main
    import codex_reviewer

    log = tmp_path / "adv-reviews.jsonl"
    monkeypatch.setattr(orchestrator_main, "ADVERSARIAL_REVIEWS_LOG", log,
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "CODEX_REVIEWS_LOG",
                        tmp_path / "codex-reviews.jsonl",
                        raising=False)
    monkeypatch.setattr(orchestrator_main, "ALERT_PATH",
                        tmp_path / "ALERT.md", raising=False)

    adv_result = ar.AdversarialReview(verdict="approve",
                                       summary="ok",
                                       findings=[])

    with patch.object(orchestrator_main, "runner") as mock_runner, \
         patch.object(orchestrator_main, "_check_forbidden_paths",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_tdd_invariant",
                       return_value=None), \
         patch.object(orchestrator_main, "_check_anthropic_response",
                       return_value="ok"), \
         patch.object(orchestrator_main, "gh"), \
         patch.object(orchestrator_main, "db"), \
         patch("orchestrator.main.codex_reviewer.run_codex_review",
                return_value=codex_reviewer.CodexReview(verdict="approve")), \
         patch("orchestrator.main.adversarial_reviewer.run_adversarial_review",
                return_value=adv_result):
        mock_runner.run_role.return_value = {
            "result": {"verdict": "approve", "summary": "ok", "comments": []},
            "in_tokens": 0, "out_tokens": 0, "cost_usd": 0,
        }
        orchestrator_main._do_review({
            "issue_id": 42, "branch": "shadow/issue-42", "repo": "r",
            "plan_json": "{}", "review_rounds": 0,
        })

    assert log.exists()
    lines = [json.loads(l) for l in log.read_text().splitlines() if l]
    assert len(lines) == 1
    assert lines[0]["claude_verdict"] == "approve"
    assert lines[0]["adversarial_verdict"] == "approve"
    assert lines[0]["disagreement"] is False
