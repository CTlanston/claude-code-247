from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from validator.judge_contract import JudgeInput, JudgeResult, normalize_response
from validator.validation_policy import validate


def _inp() -> JudgeInput:
    return JudgeInput(
        task_id="t", repo_id="r", contract="C", plan=None, worker_done=None,
        diff_summary="D", file_manifest=[], test_results=[], lint_results=[],
        build_results=[], risk_score=None, reviewer_report=None, ci_summary=None,
    )


def _result(validator: str, verdict: str, gaps: list[str] | None = None) -> JudgeResult:
    return normalize_response(validator, {
        "verdict": verdict, "confidence": 0.9, "summary": "",
        "blocking_issues": [], "non_blocking_issues": [],
        "evidence_gaps": gaps or [], "recommended_next_action": "",
    })


def test_both_pass_no_gaps_is_auto_merge_eligible() -> None:
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai", "PASS"),
    )
    assert out.ok_for_auto_merge is True
    assert out.final_verdict == "PASS"
    assert out.needs_human is False


def test_disagreement_blocks_and_routes_to_human() -> None:
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai", "FAIL"),
    )
    assert out.ok_for_auto_merge is False
    assert out.final_verdict == "DISAGREE"
    assert out.needs_human is True
    assert any("disagree" in r.lower() for r in out.reasons)


def test_pass_with_evidence_gap_routes_to_human() -> None:
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS", gaps=["missing tests for X"]),
        openai=lambda i: _result("openai", "PASS"),
    )
    assert out.ok_for_auto_merge is False
    assert out.final_verdict == "NEEDS_HUMAN"
    assert any("gap" in r.lower() for r in out.reasons)


def test_both_fail_is_fail_not_human() -> None:
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "FAIL"),
        openai=lambda i: _result("openai", "FAIL"),
    )
    assert out.ok_for_auto_merge is False
    assert out.final_verdict == "FAIL"
    assert out.needs_human is False


def test_require_two_with_only_one_enabled_routes_human(tmp_path: Path) -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "validators": {"openai": {"enabled": False}},
    }))
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai", "PASS"),  # won't be invoked
    )
    assert out.ok_for_auto_merge is False
    assert out.needs_human is True


def test_no_validators_enabled_routes_human() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "validators": {"gemini": {"enabled": False}, "openai": {"enabled": False}},
    }))
    out = validate(_inp())
    assert out.ok_for_auto_merge is False
    assert "no validators" in out.reasons[0]
