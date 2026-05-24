"""Tests for orchestrator.review_panel (Track R7).

The N-of-3 panel aggregates the three reviewer verdicts (Claude main +
Codex + Adversarial) into a structured PanelVerdict with disagreement-
as-signal classification per L7 §7.

Keyword references for compute_level R-L7 detection: this file mentions
both `n_of_3` and `disagreement_escalate` so the
REVIEW_MARKERS["n_of_3_with_escalation"] gate finds it.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import review_panel as rp  # noqa: E402


# --- All three agree on PASS ---------------------------------------------


def test_n_of_3_unanimous_approve():
    """All three voters approve → overall=approve, escalate=False."""
    pv = rp.n_of_3("approve", "approve", "approve")
    assert pv.overall == "approve"
    assert pv.agree_count == 3
    assert pv.escalate is False


def test_n_of_3_unanimous_approve_case_insensitive():
    """Verdict strings are normalised."""
    pv = rp.n_of_3("APPROVE", "Approve", "approve")
    assert pv.overall == "approve"


# --- All three agree on FAIL ---------------------------------------------


def test_n_of_3_unanimous_reject():
    pv = rp.n_of_3("reject", "reject", "reject")
    assert pv.overall == "reject"
    assert pv.agree_count == 3
    assert pv.escalate is False


def test_n_of_3_unanimous_request_changes_normalises_to_reject_class():
    """`request_changes` and `reject` both count as FAIL for panel agreement."""
    pv = rp.n_of_3("request_changes", "reject", "request_changes")
    assert pv.overall in ("reject", "request_changes")
    assert pv.escalate is False


# --- Disagreement scenarios ----------------------------------------------


def test_n_of_3_two_approve_one_reject_escalates():
    """2 PASS + 1 FAIL → overall=disagreement, escalate=True.
    The L7 §7 rule: dissent might be catching a real issue. NO
    auto-resolve. Per `disagreement_escalate` semantics, write ALERT."""
    pv = rp.n_of_3("approve", "approve", "reject")
    assert pv.escalate is True
    assert pv.disagreement_summary is not None
    assert "approve" in pv.disagreement_summary.lower()
    assert "reject" in pv.disagreement_summary.lower()


def test_n_of_3_one_approve_two_reject_escalates():
    """1 PASS + 2 FAIL → overall=request_changes, escalate=True."""
    pv = rp.n_of_3("approve", "reject", "reject")
    assert pv.escalate is True
    assert pv.overall in ("request_changes", "reject")


# --- Abstentions: skipped / error / unknown are NOT votes ----------------


def test_n_of_3_codex_skipped_is_abstention():
    """If codex is skipped (budget refused), it doesn't count as a vote.
    Two remaining voters who both approve → overall=approve, NOT
    escalate (only one voter rejected, but that voter was an
    abstention)."""
    pv = rp.n_of_3("approve", "skipped", "approve")
    assert pv.overall == "approve"
    assert pv.escalate is False
    # Codex's vote was an abstention; only 2 votes counted
    assert pv.agree_count == 2


def test_n_of_3_all_abstentions_returns_unknown():
    """All three voters abstain → overall=unknown, escalate=False (no
    signal to escalate ON)."""
    pv = rp.n_of_3("skipped", "error", "unknown")
    assert pv.overall == "unknown"
    assert pv.escalate is False


def test_n_of_3_only_one_voter_returns_their_verdict():
    """One voter approves, two abstain → overall=approve (single-voice;
    panel degrades gracefully to single-reviewer)."""
    pv = rp.n_of_3("approve", "skipped", "error")
    assert pv.overall == "approve"
    assert pv.escalate is False


# --- disagreement_escalate side effect ----------------------------------


def test_disagreement_escalate_writes_alert_when_panel_says_so(tmp_path):
    """disagreement_escalate writes ALERT.md iff panel.escalate is True.
    This is the side-effect wrapper the orchestrator calls after n_of_3."""
    pv = rp.n_of_3("approve", "approve", "reject")
    alert = tmp_path / "ALERT.md"
    wrote = rp.disagreement_escalate(pv, alert)
    assert wrote is True
    assert alert.exists()


def test_disagreement_escalate_no_alert_when_consensus(tmp_path):
    pv = rp.n_of_3("approve", "approve", "approve")
    alert = tmp_path / "ALERT.md"
    wrote = rp.disagreement_escalate(pv, alert)
    assert wrote is False
    assert not alert.exists()


# --- PanelVerdict shape -------------------------------------------------


def test_panel_verdict_fields_present():
    pv = rp.n_of_3("approve", "approve", "approve")
    assert hasattr(pv, "overall")
    assert hasattr(pv, "votes")
    assert hasattr(pv, "agree_count")
    assert hasattr(pv, "disagreement_summary")
    assert hasattr(pv, "escalate")
    # votes dict should reference the three voters by name
    assert set(pv.votes.keys()) == {"claude", "codex", "adversarial"}
