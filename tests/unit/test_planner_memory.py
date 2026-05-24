from __future__ import annotations

from pathlib import Path
from typing import Any

from runner.evidence_collector import EvidenceCollector
from runner.role_loop import (
    _planner_user_prompt,
    _gather_memory_for_planner,
    run_role_loop,
)
from runner.claude_cli import ClaudeInvocation, ClaudeResult
from validator.judge_contract import normalize_response  # for shape


def _ok(role: str) -> ClaudeResult:
    return ClaudeResult(role=role, ok=True, text="ok", raw={"result": "ok"},
                        exit_code=0, duration_s=0.01,
                        auth_mode="local_claude_code", cost_usd=None,
                        input_tokens=1, output_tokens=1)


def test_planner_prompt_has_relevant_memory_block() -> None:
    p = _planner_user_prompt(
        {"goal": "fix auth", "repo_id": "r", "branch": "b",
         "allowed_paths": ["**"], "forbidden_paths": [".env"],
         "commands": {"test": ["pytest"]}},
        memory_snippets=["[failure] OIDC scope mismatch on last run",
                          "[lesson] always validate audience claim"],
    )
    assert "RELEVANT_MEMORY" in p
    assert "OIDC scope mismatch" in p
    assert "validate audience claim" in p


def test_planner_prompt_handles_empty_memory() -> None:
    p = _planner_user_prompt(
        {"goal": "x", "repo_id": "r", "branch": "b",
         "allowed_paths": [], "forbidden_paths": []},
        memory_snippets=[],
    )
    assert "RELEVANT_MEMORY" in p
    assert "_(none)_" in p


def test_gather_memory_returns_empty_without_repo_or_goal() -> None:
    assert _gather_memory_for_planner({"goal": ""}, None) == []
    assert _gather_memory_for_planner({"repo_id": "r"}, None) == []


def test_gather_memory_uses_injected_function() -> None:
    seen: dict = {}

    def retrieve(repo_id: str, goal: str) -> list[str]:
        seen["args"] = (repo_id, goal)
        return ["m1", "m2"]

    out = _gather_memory_for_planner({"repo_id": "r", "goal": "g"}, retrieve)
    assert out == ["m1", "m2"]
    assert seen["args"] == ("r", "g")


def test_gather_memory_swallows_errors() -> None:
    def boom(repo_id: str, goal: str) -> list[str]:
        raise RuntimeError("DB missing in container")

    assert _gather_memory_for_planner({"repo_id": "r", "goal": "g"}, boom) == []


def test_role_loop_injects_memory_via_callback(tmp_path: Path) -> None:
    """run_role_loop should pass retrieved memory through to the planner
    prompt the invoke_fn sees."""
    collector = EvidenceCollector(workspace=tmp_path, task_spec={"goal": "g"})
    captured_planner_user: list[str] = []

    def invoke(inv: ClaudeInvocation, bin_: str) -> ClaudeResult:
        if inv.role == "planner":
            captured_planner_user.append(inv.user_prompt)
            (inv.cwd / ".evidence").mkdir(parents=True, exist_ok=True)
            (inv.cwd / ".evidence" / "contract.md").write_text("c")
            (inv.cwd / ".evidence" / "plan.md").write_text("p")
        if inv.role == "reviewer":
            (inv.cwd / ".evidence" / "review.md").write_text("VERDICT: PASS\n\nok")
        return _ok(inv.role)

    out = run_role_loop(
        spec={"goal": "fix auth", "repo_id": "demo",
              "allowed_paths": ["**"], "forbidden_paths": [".env"]},
        workspace=tmp_path,
        collector=collector,
        claude_bin="ignored",
        invoke_fn=invoke,
        retrieve_memory_fn=lambda r, g: [f"[lesson] mem for {r}/{g}"],
        rerun_tests=lambda: [],
    )
    assert out.ok and out.final_verdict == "PASS"
    assert captured_planner_user
    assert "mem for demo/fix auth" in captured_planner_user[0]
