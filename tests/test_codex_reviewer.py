"""Regression tests for orchestrator.codex_reviewer (Cycle 15 rewrite).

The new API runs codex via `scripts/codex_budget_guard.sh`. Tests use
a stub guard script so we never spend real OpenAI tokens during pytest.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import codex_reviewer as cr  # noqa: E402


# --- Helpers ---------------------------------------------------------------


def _make_stub_guard(tmp_path: Path, *, stdout: str = "",
                     exit_code: int = 0) -> Path:
    """Create a stub guard.sh that prints `stdout` and exits with `exit_code`.
    Bypasses the real codex binary entirely."""
    stub = tmp_path / "stub_guard.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f"cat <<'STUB_OUT'\n{stdout}\nSTUB_OUT\n"
        f"exit {exit_code}\n"
    )
    stub.chmod(0o755)
    return stub


# --- codex_available ------------------------------------------------------


def test_codex_available_false_when_no_path():
    with patch("orchestrator.codex_reviewer.shutil.which", return_value=None):
        assert cr.codex_available() is False


def test_codex_available_true_when_path_and_guard_present():
    """Both `codex` on PATH AND the guard script must exist + be executable."""
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        # GUARD_SCRIPT actually exists in the repo so the os.access check
        # returns True without mocking
        assert cr.codex_available() is True


# --- run_codex_review structured output -----------------------------------


def test_run_codex_review_returns_skipped_when_unavailable(tmp_path):
    """No codex on PATH → verdict=skipped, reason=codex_unavailable."""
    with patch("orchestrator.codex_reviewer.shutil.which", return_value=None):
        review = cr.run_codex_review(commit_sha="abc123")
    assert review.verdict == "skipped"
    assert review.reason == "codex_unavailable"
    assert review.findings == []


def test_run_codex_review_budget_refusal_returns_skipped(tmp_path):
    """Guard exits 2 (budget cap) → verdict=skipped, reason=budget."""
    stub = _make_stub_guard(tmp_path,
                             stdout="daily_cap_exceeded",
                             exit_code=2)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub)
    assert review.verdict == "skipped"
    assert review.reason == "budget"


def test_run_codex_review_parses_verdict_approve(tmp_path):
    output = "Some review text.\nverdict: approve\ntokens used\n1234\n"
    stub = _make_stub_guard(tmp_path, stdout=output, exit_code=0)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub)
    assert review.verdict == "approve"
    assert review.tokens == 1234


def test_run_codex_review_parses_verdict_reject(tmp_path):
    output = "verdict: reject\nHIGH: missing test coverage\ntokens used\n5678\n"
    stub = _make_stub_guard(tmp_path, stdout=output, exit_code=0)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub)
    assert review.verdict == "reject"
    assert review.tokens == 5678
    assert any(f.severity == "high" for f in review.findings)


def test_run_codex_review_unknown_verdict_when_unparseable(tmp_path):
    output = "(opaque output, no verdict, no tokens)\n"
    stub = _make_stub_guard(tmp_path, stdout=output, exit_code=0)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub)
    assert review.verdict == "unknown"
    assert review.tokens == 0


def test_run_codex_review_error_on_nonzero_exit(tmp_path):
    """Codex/guard exit != 0 and != 2 → verdict=error with reason set."""
    stub = _make_stub_guard(tmp_path, stdout="some output", exit_code=7)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub)
    assert review.verdict == "error"
    assert "exit=7" in (review.reason or "")


def test_run_codex_review_findings_extracted_with_categories(tmp_path):
    """Severity-tagged lines become CodexFinding entries with categories."""
    output = (
        "verdict: request_changes\n"
        "HIGH: SQL injection risk in db.py\n"
        "MEDIUM: race condition between threads\n"
        "LOW: missing test for empty list\n"
        "tokens used\n2000\n"
    )
    stub = _make_stub_guard(tmp_path, stdout=output, exit_code=0)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub)
    sevs = [f.severity for f in review.findings]
    assert sevs == ["high", "medium", "low"]
    cats = {f.category for f in review.findings}
    assert "safety" in cats     # SQL injection → safety
    assert "production-risk" in cats   # race condition
    assert "tests" in cats      # missing test


def test_run_codex_review_persists_raw_log_when_cycle_id_given(tmp_path,
                                                                 monkeypatch):
    """When cycle_id is set, raw output goes to cycles/<id>/codex-raw.log."""
    output = "verdict: approve\ntokens used\n100\n"
    stub = _make_stub_guard(tmp_path, stdout=output, exit_code=0)
    cycle_id = "20991231-235959"
    # Point REPO_ROOT to tmp so the log goes there
    monkeypatch.setattr(cr, "REPO_ROOT", tmp_path)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        cr.run_codex_review(commit_sha="abc123",
                            guard_script=stub,
                            cycle_id=cycle_id)
    log = tmp_path / "cycles" / cycle_id / "codex-raw.log"
    assert log.exists()
    assert "verdict: approve" in log.read_text()


def test_run_codex_review_handles_timeout(tmp_path):
    """A guard subprocess timeout → verdict=error with timeout reason."""
    stub = tmp_path / "slow_guard.sh"
    stub.write_text(
        "#!/usr/bin/env bash\nsleep 10\necho 'never_reached'\n"
    )
    stub.chmod(0o755)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub,
                                      timeout=1)
    assert review.verdict == "error"
    assert "timeout" in (review.reason or "")


def test_run_codex_review_uncommitted_flag(tmp_path):
    """--uncommitted is the default when no commit/base/uncommitted set."""
    output = "verdict: approve\ntokens used\n50\n"
    stub = _make_stub_guard(tmp_path, stdout=output, exit_code=0)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(uncommitted=True, guard_script=stub)
    assert review.verdict == "approve"


def test_run_codex_review_to_dict_schema(tmp_path):
    """CodexReview.to_dict() emits the kickoff §1.3 schema."""
    output = "verdict: approve\ntokens used\n100\n"
    stub = _make_stub_guard(tmp_path, stdout=output, exit_code=0)
    with patch("orchestrator.codex_reviewer.shutil.which",
               return_value="/usr/local/bin/codex"):
        review = cr.run_codex_review(commit_sha="abc123",
                                      guard_script=stub)
    d = review.to_dict()
    for key in ("source", "model", "verdict", "findings", "tokens",
                "duration_s"):
        assert key in d
    assert d["source"] == "codex"


# --- Disagreement protocol + alerts (carry-over) --------------------------


def test_disagreement_none_when_both_approve():
    assert cr.disagreement_protocol("APPROVE", "approve") is None


def test_disagreement_none_when_both_reject():
    assert cr.disagreement_protocol("REQUEST_CHANGES", "reject") is None


def test_disagreement_detects_pass_vs_fail():
    reason = cr.disagreement_protocol("APPROVE", "reject")
    assert reason is not None
    assert "claude" in reason.lower() and "codex" in reason.lower()


def test_disagreement_skipped_codex_is_not_disagreement():
    """Codex skipped/error/unknown is never a disagreement."""
    assert cr.disagreement_protocol("APPROVE", "skipped") is None
    assert cr.disagreement_protocol("REQUEST_CHANGES", "error") is None
    assert cr.disagreement_protocol("APPROVE", "unknown") is None


def test_write_alert_creates_file(tmp_path):
    alert = tmp_path / "ALERT.md"
    cr.write_alert("Claude=PASS, Codex=FAIL on diff abc1234", alert)
    assert alert.exists()
    text = alert.read_text()
    assert "abc1234" in text


def test_write_alert_appends_when_existing(tmp_path):
    alert = tmp_path / "ALERT.md"
    alert.write_text("# pre-existing\n\nfoo\n")
    cr.write_alert("new disagreement", alert)
    text = alert.read_text()
    assert "pre-existing" in text
    assert "new disagreement" in text
