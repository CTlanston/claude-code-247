"""M15: validator panel generalized to N≥1."""
from __future__ import annotations

import os
from pathlib import Path

import yaml

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


def test_extra_judges_three_pass_eligible() -> None:
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai", "PASS"),
        extra_judges=[lambda i: _result("custom", "PASS")],
    )
    assert out.ok_for_auto_merge is True
    assert len(out.results) == 3


def test_extra_judges_one_fails_blocks() -> None:
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai", "PASS"),
        extra_judges=[lambda i: _result("custom", "FAIL")],
    )
    assert out.ok_for_auto_merge is False
    assert out.final_verdict == "DISAGREE"


def test_min_validators_int_supersedes_require_two() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "validators": {"min_validators": 3,
                        "openai": {"enabled": False}},
    }))
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
    )
    assert out.ok_for_auto_merge is False
    assert out.needs_human is True
    assert any("min_validators=3" in r for r in out.reasons)


def test_min_validators_lower_allows_single_judge() -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "validators": {"min_validators": 1,
                        "openai": {"enabled": False}},
    }))
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
    )
    assert out.ok_for_auto_merge is True
