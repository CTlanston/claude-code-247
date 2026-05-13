"""Track S5 — adversarial-subagent return-check (Cycle 34).

Tests pin both halves of the contract:
  1. `run_adversarial_review` silently normalizes unknown
     `finding.category` values to "other".
  2. A public `validate_adversarial_review_contract` helper
     returns a list of contract violations (empty when valid).
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from orchestrator import adversarial_reviewer as ar  # noqa: E402
from orchestrator.adversarial_reviewer import (  # noqa: E402
    AdversarialFinding,
    AdversarialReview,
    KNOWN_FINDING_CATEGORIES,
    run_adversarial_review,
    validate_adversarial_review_contract,
)


# --- KNOWN_FINDING_CATEGORIES public constant --------------------------


def test_known_finding_categories_is_tuple():
    """The exported list must be immutable so callers can't accidentally
    extend it at runtime."""
    assert isinstance(KNOWN_FINDING_CATEGORIES, tuple)


def test_known_finding_categories_contains_all_documented_categories():
    """The 10 categories from the role-prompt schema + 'other' fallback."""
    expected = {
        "race", "trust", "silent_loss", "leak", "n_plus_1",
        "auth", "incompat", "idempotency", "toctou", "boundary",
        "other",
    }
    assert set(KNOWN_FINDING_CATEGORIES) == expected


# --- run_adversarial_review category normalization --------------------


def _fake_runner_output(*, verdict: str = "approve",
                        category: str = "race",
                        message: str = "looks racy") -> dict:
    """Build a minimal runner.run_role return value with one finding."""
    return {
        "result": {
            "verdict": verdict,
            "summary": "stub",
            "comments": [
                {"category": category, "msg": message,
                 "file": "x.py", "line": 1},
            ],
        }
    }


def test_run_adversarial_review_preserves_known_category():
    """Known categories should pass through unchanged."""
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.return_value = _fake_runner_output(category="leak")
        review = run_adversarial_review({"branch": "shadow/issue-1"}, 1)
    assert len(review.findings) == 1
    assert review.findings[0].category == "leak"


def test_run_adversarial_review_remaps_unknown_category_to_other():
    """An unknown category from the subagent should be silently
    remapped to 'other' (no crash, no exception)."""
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.return_value = _fake_runner_output(
            category="cosmic_rays"
        )
        review = run_adversarial_review({"branch": "shadow/issue-1"}, 1)
    assert len(review.findings) == 1
    assert review.findings[0].category == "other", (
        "unknown category 'cosmic_rays' should remap to 'other'"
    )
    # The original message is preserved
    assert review.findings[0].message == "looks racy"


def test_run_adversarial_review_handles_empty_category():
    """Empty/missing category should also remap to 'other'."""
    output = _fake_runner_output()
    output["result"]["comments"][0]["category"] = ""
    with patch.object(ar, "runner") as mock_runner:
        mock_runner.run_role.return_value = output
        review = run_adversarial_review({"branch": "shadow/issue-1"}, 1)
    assert review.findings[0].category == "other"


# --- validate_adversarial_review_contract -----------------------------


def _valid_review() -> AdversarialReview:
    return AdversarialReview(
        source="adversarial",
        verdict="approve",
        summary="ok",
        findings=[
            AdversarialFinding(
                category="race", message="non-empty",
                file="x.py", line=10,
            )
        ],
    )


def test_validate_returns_empty_list_for_valid_review():
    violations = validate_adversarial_review_contract(_valid_review())
    assert violations == []


def test_validate_flags_bad_verdict():
    r = _valid_review()
    r.verdict = "looks-good"
    violations = validate_adversarial_review_contract(r)
    assert any("verdict" in v.lower() for v in violations), (
        f"expected a 'verdict' violation, got {violations}"
    )


def test_validate_flags_unknown_category():
    r = _valid_review()
    r.findings[0].category = "nope"
    violations = validate_adversarial_review_contract(r)
    assert any("category" in v.lower() for v in violations)


def test_validate_flags_empty_message():
    r = _valid_review()
    r.findings[0].message = ""
    violations = validate_adversarial_review_contract(r)
    assert any("message" in v.lower() for v in violations)


def test_validate_flags_wrong_source():
    r = _valid_review()
    r.source = "claude"
    violations = validate_adversarial_review_contract(r)
    assert any("source" in v.lower() for v in violations)


def test_validate_handles_review_with_no_findings():
    """A review with verdict=approve and an empty findings list is
    valid — adversarial reviewer is allowed to find nothing."""
    r = AdversarialReview(
        source="adversarial", verdict="approve",
        summary="all good", findings=[],
    )
    assert validate_adversarial_review_contract(r) == []


def test_validate_accumulates_multiple_violations():
    """When multiple things are wrong, all of them surface in the
    returned list."""
    r = AdversarialReview(
        source="other-source",
        verdict="not-a-verdict",
        summary="",
        findings=[
            AdversarialFinding(category="bogus", message="", file="x", line=1),
        ],
    )
    violations = validate_adversarial_review_contract(r)
    assert len(violations) >= 3, (
        f"expected >= 3 violations across source/verdict/finding fields, "
        f"got {len(violations)}: {violations}"
    )
