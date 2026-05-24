from __future__ import annotations

import json
from pathlib import Path

import pytest

from validator.judge_contract import (
    JudgeError,
    JudgeInput,
    evidence_prompt,
    normalize_response,
)


def _seed_evidence_dir(p: Path) -> Path:
    e = p / ".evidence"
    e.mkdir()
    (e / "contract.md").write_text("# Contract\nDeliver X.\n")
    (e / "plan.md").write_text("# Plan\n")
    (e / "worker_done.md").write_text("ok")
    (e / "diff_summary.md").write_text("```\nsrc/x.py | 1 +\n```\n")
    (e / "file_manifest.json").write_text(json.dumps(["src/x.py"]))
    (e / "test_results.json").write_text(json.dumps([{"cmd": "pytest", "exit": 0}]))
    (e / "lint_results.json").write_text(json.dumps([]))
    (e / "build_results.json").write_text(json.dumps([]))
    (e / "review.md").write_text("VERDICT: PASS\n")
    return e


def test_from_evidence_dir_reads_all_artifacts(tmp_path: Path) -> None:
    e = _seed_evidence_dir(tmp_path)
    inp = JudgeInput.from_evidence_dir(e, task_id="t1", repo_id="r1")
    assert inp.contract.startswith("# Contract")
    assert inp.test_results[0]["cmd"] == "pytest"
    assert inp.file_manifest == ["src/x.py"]
    assert inp.reviewer_report and inp.reviewer_report.startswith("VERDICT: PASS")


def test_from_evidence_dir_gracefully_handles_missing(tmp_path: Path) -> None:
    e = tmp_path / "empty_evidence"
    e.mkdir()
    inp = JudgeInput.from_evidence_dir(e, task_id="t", repo_id="r")
    assert inp.contract == ""
    assert inp.plan is None
    assert inp.test_results == []
    assert inp.file_manifest == []


def test_evidence_prompt_contains_required_sections(tmp_path: Path) -> None:
    inp = JudgeInput(
        task_id="t", repo_id="r", contract="C", plan=None, worker_done=None,
        diff_summary="D", file_manifest=[], test_results=[], lint_results=[],
        build_results=[], risk_score=None, reviewer_report=None, ci_summary=None,
    )
    prompt = evidence_prompt(inp)
    for header in ("CONTRACT", "PLAN", "WORKER_DONE", "DIFF", "FILE_MANIFEST",
                   "TEST_RESULTS", "LINT_RESULTS", "BUILD_RESULTS", "RISK_SCORE",
                   "REVIEWER_REPORT"):
        assert f"## {header}" in prompt
    # No conversation transcript leak. The word "conversation" may
    # legitimately appear in meta-instructions (e.g., "do not ask for
    # hidden conversation context" — the M19/BR-001 validator briefing);
    # what we guard against is actual chat content showing up.
    assert "conversation history" not in prompt.lower()
    assert "user said" not in prompt.lower()
    assert "assistant said" not in prompt.lower()


def test_normalize_response_accepts_valid_payload() -> None:
    payload = {
        "verdict": "pass", "confidence": 0.9, "summary": "ok",
        "blocking_issues": [], "non_blocking_issues": [],
        "evidence_gaps": [], "recommended_next_action": "merge",
    }
    r = normalize_response("gemini", payload)
    assert r.verdict == "PASS"
    assert r.confidence == 0.9
    assert r.validator == "gemini"


def test_normalize_response_clamps_confidence() -> None:
    payload = {"verdict": "PASS", "confidence": 1.5,
               "summary": "", "blocking_issues": [], "non_blocking_issues": [],
               "evidence_gaps": [], "recommended_next_action": ""}
    r = normalize_response("v", payload)
    assert r.confidence == 1.0


def test_normalize_response_rejects_bad_verdict() -> None:
    with pytest.raises(JudgeError):
        normalize_response("v", {"verdict": "MAYBE"})
