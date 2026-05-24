"""M18-P1: integration of the dual-real requirement with merge_policy.

If validators land NEEDS_HUMAN because mock was disallowed, the merge
policy must surface this as WAITING_APPROVAL (not BLOCKED, not
AUTO_MERGE)."""
from __future__ import annotations

import os
from pathlib import Path

import yaml

from orchestrator.merge_policy import MergeDecision, decide
from orchestrator.repo_registry import RepoEntry
from orchestrator.risk_score import RiskAssessment
from validator.judge_contract import JudgeInput, normalize_response
from validator.validation_policy import validate


def _inp() -> JudgeInput:
    return JudgeInput(
        task_id="t", repo_id="r", contract="C", plan=None, worker_done=None,
        diff_summary="D", file_manifest=[], test_results=[], lint_results=[],
        build_results=[], risk_score=None, reviewer_report=None, ci_summary=None,
    )


def _result(name: str, verdict: str):
    return normalize_response(name, {
        "verdict": verdict, "confidence": 0.9, "summary": "",
        "blocking_issues": [], "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "",
    })


def _repo(enabled: bool = True) -> RepoEntry:
    return RepoEntry(
        id="demo", name="demo", github_owner="o", github_repo="r",
        local_path="/tmp/x", default_branch="main", enabled=True,
        risk_level="low",
        raw={"id": "demo",
             "auto_merge": {"enabled": enabled, "max_risk_score": 30,
                             "max_changed_lines": 300},
             "forbidden_paths": [".env"]},
    )


def _flip_writes_on() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "system": {"allow_remote_writes": True},
    }))


def test_real_plus_mock_routes_to_waiting_approval() -> None:
    _flip_writes_on()
    validation = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai-mock", "PASS"),
    )
    # validate() should now say NEEDS_HUMAN because mock present and
    # allow_mock=False by default.
    assert validation.final_verdict == "NEEDS_HUMAN"
    ruling = decide(
        risk=RiskAssessment(score=10, level="low", triggered=[]),
        validators=validation,
        repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    # Merge policy maps NEEDS_HUMAN → WAITING_APPROVAL.
    assert ruling.decision == MergeDecision.WAITING_APPROVAL


def test_dual_real_pass_routes_to_auto_merge() -> None:
    _flip_writes_on()
    validation = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai", "PASS"),
    )
    assert validation.final_verdict == "PASS"
    ruling = decide(
        risk=RiskAssessment(score=10, level="low", triggered=[]),
        validators=validation,
        repo=_repo(),
        ci_passed=True, tests_passed=True, lint_passed=True,
    )
    assert ruling.decision == MergeDecision.AUTO_MERGE
