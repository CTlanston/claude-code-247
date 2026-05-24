"""M16: secret_scanner is a hard merge gate (directive §14)."""
from __future__ import annotations

import os
from pathlib import Path

import yaml

from orchestrator.merge_policy import MergeDecision, decide
from orchestrator.repo_registry import RepoEntry
from orchestrator.risk_score import RiskAssessment
from validator.judge_contract import normalize_response
from validator.validation_policy import ValidationOutcome


def _repo() -> RepoEntry:
    return RepoEntry(
        id="demo", name="demo", github_owner="o", github_repo="r",
        local_path="/tmp/x", default_branch="main", enabled=True, risk_level="low",
        raw={"id": "demo",
             "auto_merge": {"enabled": True, "max_risk_score": 30,
                             "max_changed_lines": 300},
             "forbidden_paths": [".env"]},
    )


def _all_pass() -> ValidationOutcome:
    r = normalize_response("g", {"verdict": "PASS", "confidence": 0.9,
                                   "summary": "", "blocking_issues": [],
                                   "non_blocking_issues": [], "evidence_gaps": [],
                                   "recommended_next_action": ""})
    return ValidationOutcome(
        ok_for_auto_merge=True, needs_human=False,
        final_verdict="PASS", results=[r, r], reasons=["all PASS"],
    )


def _low_risk() -> RiskAssessment:
    return RiskAssessment(score=10, level="low", triggered=[])


def _flip_writes_on() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": True},
    }))


def test_clean_diff_still_auto_merges() -> None:
    _flip_writes_on()
    ruling = decide(
        risk=_low_risk(), validators=_all_pass(), repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
        diff_content="+def add(a, b):\n+    return a + b\n",
    )
    assert ruling.decision == MergeDecision.AUTO_MERGE


def test_github_pat_blocks_auto_merge() -> None:
    _flip_writes_on()
    diff = "+TOKEN = 'gh" + "p_" + "a" * 36 + "'\n"
    ruling = decide(
        risk=_low_risk(), validators=_all_pass(), repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
        diff_content=diff,
    )
    assert ruling.decision == MergeDecision.BLOCKED
    assert any("secret-like" in r for r in ruling.reasons)


def test_anthropic_key_blocks_auto_merge() -> None:
    _flip_writes_on()
    diff = "+ANTHROPIC_API_KEY = 'sk-ant-" + "x" * 40 + "'\n"
    ruling = decide(
        risk=_low_risk(), validators=_all_pass(), repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
        diff_content=diff,
    )
    assert ruling.decision == MergeDecision.BLOCKED


def test_no_diff_content_does_not_break() -> None:
    _flip_writes_on()
    ruling = decide(
        risk=_low_risk(), validators=_all_pass(), repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
        diff_content=None,
    )
    assert ruling.decision == MergeDecision.AUTO_MERGE


def test_secret_block_outranks_lower_priority_gates() -> None:
    """Even if writes-off would normally route to WAITING_APPROVAL,
    secret content escalates to a hard BLOCK."""
    # writes off by default
    diff = "+aws = 'AKIA" + "A" * 16 + "'\n"
    ruling = decide(
        risk=_low_risk(), validators=_all_pass(), repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
        diff_content=diff,
    )
    assert ruling.decision == MergeDecision.BLOCKED
