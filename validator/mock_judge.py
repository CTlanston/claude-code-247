"""Mock validator — deterministic verdict from local rules.

Used:
  * In tests, always.
  * In production, when the corresponding API key is missing.

The rule set is intentionally simple so the orchestrator can still drive
the policy engine end-to-end without external APIs:

  - any test result with exit != 0  → FAIL with that command in blocking_issues
  - lint failures                  → non_blocking_issues
  - empty contract                 → NEEDS_HUMAN ("missing contract")
  - reviewer marked NEEDS_HUMAN    → propagate
  - otherwise                      → PASS at confidence 0.5
"""
from __future__ import annotations

from validator.judge_contract import JudgeInput, JudgeResult, normalize_response


def judge(inp: JudgeInput, *, validator_name: str = "mock") -> JudgeResult:
    blocking: list[str] = []
    non_blocking: list[str] = []
    gaps: list[str] = []
    summary = ""

    if not inp.contract.strip():
        gaps.append("contract.md is empty")
    test_failures = [r for r in inp.test_results if r.get("exit", 0) != 0]
    lint_failures = [r for r in inp.lint_results if r.get("exit", 0) != 0]
    build_failures = [r for r in inp.build_results if r.get("exit", 0) != 0]

    for r in test_failures:
        blocking.append(f"test failed: {r.get('cmd')!r}")
    for r in build_failures:
        blocking.append(f"build failed: {r.get('cmd')!r}")
    for r in lint_failures:
        non_blocking.append(f"lint failed: {r.get('cmd')!r}")

    reviewer_says_human = (inp.reviewer_report or "").strip().startswith("VERDICT: NEEDS_HUMAN")

    if gaps and not (test_failures or build_failures):
        verdict = "NEEDS_HUMAN"
        summary = "evidence package missing required artifacts"
    elif reviewer_says_human:
        verdict = "NEEDS_HUMAN"
        summary = "reviewer escalated to human"
    elif blocking:
        verdict = "FAIL"
        summary = f"{len(test_failures)} test failure(s), {len(build_failures)} build failure(s)"
    else:
        verdict = "PASS"
        summary = "all gates green per mock validator"

    payload = {
        "verdict": verdict,
        "confidence": 0.95 if verdict == "PASS" and not non_blocking else 0.7,
        "summary": summary,
        "blocking_issues": blocking,
        "non_blocking_issues": non_blocking,
        "evidence_gaps": gaps,
        "recommended_next_action": {
            "PASS": "proceed to merge gate",
            "FAIL": "repair failing tests/builds",
            "NEEDS_HUMAN": "human review required",
        }[verdict],
    }
    return normalize_response(validator_name, payload, auth_mode="mock")
