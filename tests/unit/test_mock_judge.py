from __future__ import annotations

from validator.judge_contract import JudgeInput
from validator.mock_judge import judge


def _inp(**overrides) -> JudgeInput:
    base = dict(
        task_id="t", repo_id="r", contract="C", plan=None, worker_done=None,
        diff_summary="D", file_manifest=[], test_results=[], lint_results=[],
        build_results=[], risk_score=None, reviewer_report=None, ci_summary=None,
    )
    base.update(overrides)
    return JudgeInput(**base)


def test_pass_when_all_green() -> None:
    r = judge(_inp(test_results=[{"cmd": "pytest", "exit": 0}]))
    assert r.verdict == "PASS"
    assert r.confidence >= 0.9


def test_fail_when_test_exits_nonzero() -> None:
    r = judge(_inp(test_results=[{"cmd": "pytest", "exit": 1}]))
    assert r.verdict == "FAIL"
    assert any("pytest" in b for b in r.blocking_issues)


def test_lint_failure_is_non_blocking() -> None:
    r = judge(_inp(
        test_results=[{"cmd": "pytest", "exit": 0}],
        lint_results=[{"cmd": "ruff", "exit": 1}],
    ))
    assert r.verdict == "PASS"
    assert any("ruff" in nb for nb in r.non_blocking_issues)


def test_needs_human_when_contract_missing() -> None:
    r = judge(_inp(contract=""))
    assert r.verdict == "NEEDS_HUMAN"
    assert any("contract" in g for g in r.evidence_gaps)


def test_needs_human_propagates_from_reviewer() -> None:
    r = judge(_inp(
        test_results=[{"cmd": "pytest", "exit": 0}],
        reviewer_report="VERDICT: NEEDS_HUMAN\n...",
    ))
    assert r.verdict == "NEEDS_HUMAN"
