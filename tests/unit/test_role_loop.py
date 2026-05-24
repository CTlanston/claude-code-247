from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import pytest

from runner.claude_cli import ClaudeInvocation, ClaudeResult
from runner.evidence_collector import EvidenceCollector
from runner.role_loop import RoleLoopOutcome, run_role_loop


def _ok_result(role: str, text: str = "ok") -> ClaudeResult:
    return ClaudeResult(role=role, ok=True, text=text, raw={"result": text},
                        exit_code=0, duration_s=0.01, auth_mode="local_claude_code",
                        cost_usd=None, input_tokens=1, output_tokens=1)


def _make_invoke(
    *,
    write_review: str | None = None,
    write_contract: bool = True,
    fail_role: str | None = None,
) -> Callable[[ClaudeInvocation, str], ClaudeResult]:
    seen: list[str] = []

    def fn(inv: ClaudeInvocation, bin_: str) -> ClaudeResult:
        seen.append(inv.role)
        if fail_role and inv.role == fail_role:
            return ClaudeResult(role=inv.role, ok=False, text="", raw={},
                                exit_code=1, duration_s=0.01,
                                auth_mode="local_claude_code", cost_usd=None,
                                input_tokens=0, output_tokens=0, error="boom")
        if inv.role == "planner" and write_contract:
            (inv.cwd / ".evidence").mkdir(parents=True, exist_ok=True)
            (inv.cwd / ".evidence" / "contract.md").write_text("# contract\nGoal: do x.\n")
            (inv.cwd / ".evidence" / "plan.md").write_text("# plan\nstep 1.\n")
        if inv.role == "coder":
            (inv.cwd / ".evidence" / "worker_done.md").write_text("ok\n")
        if inv.role == "reviewer" and write_review is not None:
            (inv.cwd / ".evidence" / "review.md").write_text(write_review)
        return _ok_result(inv.role)

    fn.seen = seen  # type: ignore[attr-defined]
    return fn


def test_loop_pass_path(tmp_path: Path) -> None:
    collector = EvidenceCollector(workspace=tmp_path, task_spec={"goal": "g"})
    invoke = _make_invoke(write_review="VERDICT: PASS\n\nlooks fine.")
    out = run_role_loop(
        spec={"goal": "g", "allowed_paths": ["**"], "forbidden_paths": [".env"]},
        workspace=tmp_path,
        collector=collector,
        claude_bin="ignored",
        invoke_fn=invoke,
        rerun_tests=lambda: [],
    )
    assert out.ok is True
    assert out.final_verdict == "PASS"
    assert out.repair_attempts == 0
    # planner, coder, reviewer — no repair
    roles = [r["role"] for r in out.role_results]
    assert roles == ["planner", "coder", "reviewer"]


def test_loop_repair_loop_succeeds_within_max(tmp_path: Path) -> None:
    collector = EvidenceCollector(workspace=tmp_path, task_spec={"goal": "g"})
    # Reviewer says NEEDS_REPAIR first two times, PASS the third.
    verdicts = iter(["VERDICT: NEEDS_REPAIR\n\nfix tests.",
                     "VERDICT: NEEDS_REPAIR\n\nstill broken.",
                     "VERDICT: PASS\n\nfixed."])
    seen: list[str] = []

    def invoke(inv: ClaudeInvocation, bin_: str) -> ClaudeResult:
        seen.append(inv.role)
        if inv.role == "planner":
            (inv.cwd / ".evidence").mkdir(parents=True, exist_ok=True)
            (inv.cwd / ".evidence" / "contract.md").write_text("# c\n")
            (inv.cwd / ".evidence" / "plan.md").write_text("# p\n")
        if inv.role == "reviewer":
            (inv.cwd / ".evidence" / "review.md").write_text(next(verdicts))
        return _ok_result(inv.role)

    out = run_role_loop(
        spec={"goal": "g", "allowed_paths": ["**"], "forbidden_paths": [".env"]},
        workspace=tmp_path,
        collector=collector,
        claude_bin="ignored",
        invoke_fn=invoke,
        rerun_tests=lambda: [],
        max_repair_attempts=3,
    )
    assert out.ok
    assert out.final_verdict == "PASS"
    assert out.repair_attempts == 2
    # Role order: planner, coder, reviewer, repair#1, reviewer, repair#2, reviewer
    assert seen == ["planner", "coder", "reviewer",
                    "repair#1", "reviewer",
                    "repair#2", "reviewer"]


def test_loop_repair_loop_gives_up_after_max(tmp_path: Path) -> None:
    collector = EvidenceCollector(workspace=tmp_path, task_spec={"goal": "g"})

    def invoke(inv: ClaudeInvocation, bin_: str) -> ClaudeResult:
        if inv.role == "planner":
            (inv.cwd / ".evidence").mkdir(parents=True, exist_ok=True)
            (inv.cwd / ".evidence" / "contract.md").write_text("c")
            (inv.cwd / ".evidence" / "plan.md").write_text("p")
        if inv.role == "reviewer":
            (inv.cwd / ".evidence" / "review.md").write_text("VERDICT: NEEDS_REPAIR\n\nfix.")
        return _ok_result(inv.role)

    out = run_role_loop(
        spec={"goal": "g", "allowed_paths": ["**"], "forbidden_paths": [".env"]},
        workspace=tmp_path,
        collector=collector,
        claude_bin="ignored",
        invoke_fn=invoke,
        rerun_tests=lambda: [],
        max_repair_attempts=2,
    )
    assert out.ok is False
    assert out.final_verdict == "FAIL"
    assert out.repair_attempts == 2
    assert any("max_repair_attempts" in n for n in out.notes)


def test_loop_needs_human_short_circuits(tmp_path: Path) -> None:
    collector = EvidenceCollector(workspace=tmp_path, task_spec={"goal": "g"})
    invoke = _make_invoke(write_review="VERDICT: NEEDS_HUMAN\n\nout of scope.")
    out = run_role_loop(
        spec={"goal": "g", "allowed_paths": ["**"], "forbidden_paths": [".env"]},
        workspace=tmp_path,
        collector=collector,
        claude_bin="ignored",
        invoke_fn=invoke,
        rerun_tests=lambda: [],
    )
    assert out.final_verdict == "NEEDS_HUMAN"
    assert out.repair_attempts == 0


def test_loop_planner_failure_errors(tmp_path: Path) -> None:
    collector = EvidenceCollector(workspace=tmp_path, task_spec={"goal": "g"})
    invoke = _make_invoke(fail_role="planner")
    out = run_role_loop(
        spec={"goal": "g", "allowed_paths": ["**"], "forbidden_paths": [".env"]},
        workspace=tmp_path,
        collector=collector,
        claude_bin="ignored",
        invoke_fn=invoke,
        rerun_tests=lambda: [],
    )
    assert out.final_verdict == "ERROR"
    assert out.ok is False
    assert any("planner failed" in n for n in out.notes)


def test_loop_reviewer_with_no_verdict_marks_error(tmp_path: Path) -> None:
    collector = EvidenceCollector(workspace=tmp_path, task_spec={"goal": "g"})

    def invoke(inv: ClaudeInvocation, bin_: str) -> ClaudeResult:
        if inv.role == "planner":
            (inv.cwd / ".evidence").mkdir(parents=True, exist_ok=True)
            (inv.cwd / ".evidence" / "contract.md").write_text("c")
            (inv.cwd / ".evidence" / "plan.md").write_text("p")
        if inv.role == "reviewer":
            (inv.cwd / ".evidence" / "review.md").write_text("just text, no verdict\n")
        return _ok_result(inv.role)

    out = run_role_loop(
        spec={"goal": "g", "allowed_paths": ["**"], "forbidden_paths": [".env"]},
        workspace=tmp_path,
        collector=collector,
        claude_bin="ignored",
        invoke_fn=invoke,
        rerun_tests=lambda: [],
    )
    assert out.final_verdict == "ERROR"
    assert any("VERDICT" in n for n in out.notes)
