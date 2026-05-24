"""M18-P1: mock validators cannot silently count for auto-merge."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
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


def _write_validators_cfg(**overrides) -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({"validators": overrides}))


def test_real_gemini_plus_mock_openai_blocks_auto_merge_by_default() -> None:
    """Default config has allow_mock_validators_for_auto_merge=false →
    presence of any -mock validator routes to approval even if all PASS."""
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai-mock", "PASS"),
    )
    assert out.ok_for_auto_merge is False
    assert out.needs_human is True
    assert any("mock" in r for r in out.reasons)


def test_mock_allowed_for_auto_merge_when_flag_true() -> None:
    # Have to drop both the global mock gate AND the per-validator
    # require_real_for_auto_merge (which defaults true for openai).
    _write_validators_cfg(
        allow_mock_validators_for_auto_merge=True,
        gemini={"enabled": True, "require_real_for_auto_merge": False},
        openai={"enabled": True, "require_real_for_auto_merge": False},
    )
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai-mock", "PASS"),
    )
    assert out.ok_for_auto_merge is True
    assert out.final_verdict == "PASS"


def test_per_validator_require_real_blocks_mock() -> None:
    """validators.openai.require_real_for_auto_merge=true must block
    even if allow_mock_validators_for_auto_merge is true (per-validator
    rule is stricter)."""
    _write_validators_cfg(
        allow_mock_validators_for_auto_merge=True,
        openai={"enabled": True, "require_real_for_auto_merge": True},
    )
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai-mock", "PASS"),
    )
    assert out.ok_for_auto_merge is False
    assert any("require_real_for_auto_merge" in r for r in out.reasons)


def test_both_real_passes_auto_merge_eligible() -> None:
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai", "PASS"),
    )
    assert out.ok_for_auto_merge is True
    assert out.final_verdict == "PASS"


def test_mock_gate_does_not_override_disagreement() -> None:
    """When validators disagree, that's still DISAGREE — the mock gate
    is only consulted on the all-PASS path."""
    out = validate(
        _inp(),
        gemini=lambda i: _result("gemini", "PASS"),
        openai=lambda i: _result("openai-mock", "FAIL"),
    )
    assert out.final_verdict == "DISAGREE"
