from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from orchestrator.config import load_config
from orchestrator.merge_policy import MergeDecision, decide
from orchestrator.repo_registry import RepoEntry
from orchestrator.risk_score import RiskAssessment, RiskFactor
from validator.judge_contract import normalize_response
from validator.validation_policy import ValidationOutcome


def _repo(*, auto_merge_enabled: bool = True, max_score: int = 30,
          max_lines: int = 300) -> RepoEntry:
    return RepoEntry(
        id="demo", name="demo", github_owner="o", github_repo="r",
        local_path="/tmp/x", default_branch="main", enabled=True, risk_level="low",
        raw={
            "id": "demo",
            "auto_merge": {"enabled": auto_merge_enabled,
                           "max_risk_score": max_score,
                           "max_changed_lines": max_lines},
            "forbidden_paths": [".env"],
        },
    )


def _risk(score: int, *, forbidden: bool = False) -> RiskAssessment:
    triggered = []
    if forbidden:
        triggered.append(RiskFactor("forbidden_path_touch", 100, ".env", True))
    level = "low" if score <= 30 else ("medium" if score <= 70 else "high")
    return RiskAssessment(score=score, level=level, triggered=triggered)


def _validators(verdict: str = "PASS") -> ValidationOutcome:
    r = normalize_response("g", {"verdict": verdict, "confidence": 0.9,
                                  "summary": "", "blocking_issues": [],
                                  "non_blocking_issues": [], "evidence_gaps": [],
                                  "recommended_next_action": ""})
    return ValidationOutcome(
        ok_for_auto_merge=(verdict == "PASS"),
        needs_human=(verdict != "PASS"),
        final_verdict=verdict,
        results=[r, r],
        reasons=["test"],
    )


def _flip_remote_writes(value: bool) -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": value},
    }))


def test_low_risk_all_green_with_writes_on_auto_merges() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(10),
        validators=_validators("PASS"),
        repo=_repo(),
        ci_passed=True,
        tests_passed=True,
        lint_passed=True,
    )
    assert ruling.decision == MergeDecision.AUTO_MERGE


def test_low_risk_blocked_when_remote_writes_off() -> None:
    _flip_remote_writes(False)
    ruling = decide(
        risk=_risk(10),
        validators=_validators("PASS"),
        repo=_repo(),
        ci_passed=True,
        tests_passed=True,
        lint_passed=True,
    )
    assert ruling.decision == MergeDecision.WAITING_APPROVAL
    assert any("allow_remote_writes" in r for r in ruling.reasons)


def test_medium_risk_requires_approval() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(50),
        validators=_validators("PASS"),
        repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.WAITING_APPROVAL


def test_high_risk_is_blocked() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(85),
        validators=_validators("PASS"),
        repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.BLOCKED


def test_forbidden_path_touch_always_blocks() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(20, forbidden=True),
        validators=_validators("PASS"),
        repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.BLOCKED


def test_validator_fail_blocks_even_low_risk() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(10),
        validators=_validators("FAIL"),
        repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.BLOCKED


def test_validator_disagree_routes_to_approval() -> None:
    _flip_remote_writes(True)
    v = ValidationOutcome(
        ok_for_auto_merge=False, needs_human=True, final_verdict="DISAGREE",
        results=[], reasons=["disagree"],
    )
    ruling = decide(
        risk=_risk(10), validators=v, repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.WAITING_APPROVAL


def test_repo_auto_merge_disabled_routes_to_approval() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(10),
        validators=_validators("PASS"),
        repo=_repo(auto_merge_enabled=False),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.WAITING_APPROVAL


def test_repo_max_risk_cap_routes_to_approval() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(25),
        validators=_validators("PASS"),
        repo=_repo(max_score=10),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.WAITING_APPROVAL


def test_ci_failure_blocks() -> None:
    _flip_remote_writes(True)
    ruling = decide(
        risk=_risk(10),
        validators=_validators("PASS"),
        repo=_repo(),
        ci_passed=False, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.BLOCKED
