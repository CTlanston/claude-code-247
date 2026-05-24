"""Planner → Coder → Reviewer → Repair role loop.

Driven from ``runner.worker --allow-roles``. Each role is a SEPARATE
``claude --print`` invocation (no ``--resume``); the Reviewer therefore
sees no Coder conversation, only the artifacts in ``.evidence/``.

The loop:

  1. planner   — produces plan.md, contract.md, risk_assessment.md
  2. coder     — implements; expected to write code + tests + worker_done.md
  3. tests     — orchestrator-side test commands (already done by worker
                 before role_loop runs; we re-run after coder to confirm)
  4. reviewer  — judges; verdict PASS / FAIL / NEEDS_REPAIR / NEEDS_HUMAN
  5. repair    — if reviewer = NEEDS_REPAIR and attempts < max, run; goto 3

Returns a structured ``RoleLoopOutcome`` the worker writes into
worker_done.md.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from runner.claude_cli import ClaudeInvocation, ClaudeResult, invoke
from runner.evidence_collector import EvidenceCollector

DEFAULT_ALLOWED_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"]
ROLES_DIR = Path(__file__).resolve().parent / "roles"


def role_system_prompt(role: str) -> str:
    p = ROLES_DIR / f"{role}.md"
    if not p.exists():
        raise FileNotFoundError(f"role template missing: {p}")
    return p.read_text(encoding="utf-8")


@dataclass
class RoleLoopOutcome:
    ok: bool
    final_verdict: str                  # PASS|FAIL|NEEDS_REPAIR|NEEDS_HUMAN|ERROR
    repair_attempts: int
    role_results: list[dict[str, Any]]  # one per claude invocation
    notes: list[str] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "final_verdict": self.final_verdict,
            "repair_attempts": self.repair_attempts,
            "role_results": self.role_results,
            "notes": self.notes,
        }


def run_role_loop(
    *,
    spec: dict[str, Any],
    workspace: Path,
    collector: EvidenceCollector,
    claude_bin: str = "claude",
    invoke_fn: Callable[[ClaudeInvocation, str], ClaudeResult] | None = None,
    rerun_tests: Callable[[], list[dict[str, Any]]] | None = None,
    model: str | None = None,
    max_repair_attempts: int = 3,
) -> RoleLoopOutcome:
    """Execute Planner → Coder → Reviewer → (Repair loop). Pure dispatch.

    ``invoke_fn`` is injectable for tests; default uses the real CLI.
    ``rerun_tests`` callback is what runs the repo's test commands again
    after the Coder/Repair; provided by the worker.
    """
    invoke_real = invoke_fn or (lambda inv, bin_: invoke(inv, claude_bin=bin_))
    results: list[dict[str, Any]] = []
    notes: list[str] = []

    # --- Planner -----------------------------------------------------
    planner_user = _planner_user_prompt(spec)
    planner_inv = ClaudeInvocation(
        role="planner",
        user_prompt=planner_user,
        system_prompt=role_system_prompt("planner"),
        allowed_tools=DEFAULT_ALLOWED_TOOLS,
        model=model,
        cwd=workspace,
    )
    planner_res = invoke_real(planner_inv, claude_bin)
    results.append(_summary(planner_res))
    if not planner_res.ok:
        return RoleLoopOutcome(False, "ERROR", 0, results,
                               notes=[f"planner failed: {planner_res.error}"])

    # Make sure contract.md exists (planner may have produced it, but if
    # the model misbehaved, fall back to a synthesized contract from spec).
    if not (workspace / ".evidence" / "contract.md").exists():
        notes.append("planner did not write contract.md; falling back to spec")
        collector.write_contract()

    # --- Coder -------------------------------------------------------
    coder_user = _coder_user_prompt(spec, workspace)
    coder_inv = ClaudeInvocation(
        role="coder",
        user_prompt=coder_user,
        system_prompt=role_system_prompt("coder"),
        allowed_tools=DEFAULT_ALLOWED_TOOLS,
        model=model,
        cwd=workspace,
    )
    coder_res = invoke_real(coder_inv, claude_bin)
    results.append(_summary(coder_res))
    if not coder_res.ok:
        return RoleLoopOutcome(False, "ERROR", 0, results,
                               notes=notes + [f"coder failed: {coder_res.error}"])

    # Re-run repo's tests after Coder so the Reviewer judges the latest state.
    if rerun_tests is not None:
        post_coder_tests = rerun_tests()
    else:
        post_coder_tests = []

    # --- Reviewer / Repair loop -------------------------------------
    final_verdict = "NEEDS_HUMAN"
    repair_attempts = 0
    while True:
        reviewer_inv = ClaudeInvocation(
            role="reviewer",
            user_prompt=_reviewer_user_prompt(workspace, post_coder_tests),
            system_prompt=role_system_prompt("reviewer"),
            allowed_tools=["Read", "Grep", "Glob"],
            model=model,
            cwd=workspace,
        )
        reviewer_res = invoke_real(reviewer_inv, claude_bin)
        results.append(_summary(reviewer_res))

        verdict = _parse_verdict(workspace / ".evidence" / "review.md") or _parse_verdict_from_text(reviewer_res.text)
        if verdict is None:
            return RoleLoopOutcome(
                False, "ERROR", repair_attempts, results,
                notes=notes + ["reviewer produced no VERDICT line"],
            )
        final_verdict = verdict
        if verdict == "PASS":
            return RoleLoopOutcome(True, "PASS", repair_attempts, results, notes=notes)
        if verdict in ("FAIL", "NEEDS_HUMAN"):
            return RoleLoopOutcome(False, verdict, repair_attempts, results, notes=notes)

        # NEEDS_REPAIR
        if repair_attempts >= max_repair_attempts:
            notes.append(f"exceeded max_repair_attempts={max_repair_attempts}")
            return RoleLoopOutcome(False, "FAIL", repair_attempts, results, notes=notes)
        repair_attempts += 1
        repair_inv = ClaudeInvocation(
            role=f"repair#{repair_attempts}",
            user_prompt=_repair_user_prompt(workspace, post_coder_tests),
            system_prompt=role_system_prompt("repair"),
            allowed_tools=DEFAULT_ALLOWED_TOOLS,
            model=model,
            cwd=workspace,
        )
        repair_res = invoke_real(repair_inv, claude_bin)
        results.append(_summary(repair_res))
        if not repair_res.ok:
            notes.append(f"repair attempt {repair_attempts} CLI error: {repair_res.error}")
            return RoleLoopOutcome(False, "ERROR", repair_attempts, results, notes=notes)
        if rerun_tests is not None:
            post_coder_tests = rerun_tests()


# ────────────────────────────────────────────────────────────────────


def _planner_user_prompt(spec: dict[str, Any]) -> str:
    return (
        f"GOAL\n{spec.get('goal', '')}\n\n"
        f"REPO\n{json.dumps({k: spec.get(k) for k in ('repo_id', 'branch')}, indent=2)}\n\n"
        f"ALLOWED_PATHS\n{json.dumps(spec.get('allowed_paths') or [])}\n\n"
        f"FORBIDDEN_PATHS\n{json.dumps(spec.get('forbidden_paths') or [])}\n\n"
        f"TEST_COMMANDS\n{json.dumps((spec.get('commands') or {}).get('test') or [])}\n\n"
        "Write plan.md, contract.md, risk_assessment.md, worker_breakdown.md"
        " into ./.evidence/ before exiting."
    )


def _coder_user_prompt(spec: dict[str, Any], workspace: Path) -> str:
    contract_path = workspace / ".evidence" / "contract.md"
    contract = contract_path.read_text(encoding="utf-8") if contract_path.exists() else ""
    plan_path = workspace / ".evidence" / "plan.md"
    plan = plan_path.read_text(encoding="utf-8") if plan_path.exists() else ""
    return (
        f"CONTRACT\n{contract}\n\n"
        f"PLAN\n{plan}\n\n"
        f"ALLOWED_PATHS\n{json.dumps(spec.get('allowed_paths') or [])}\n\n"
        f"FORBIDDEN_PATHS\n{json.dumps(spec.get('forbidden_paths') or [])}\n\n"
        "Execute the contract. Write ./.evidence/worker_done.md when finished."
    )


def _reviewer_user_prompt(workspace: Path, tests: list[dict[str, Any]]) -> str:
    ev = workspace / ".evidence"
    contract = (ev / "contract.md").read_text() if (ev / "contract.md").exists() else ""
    diff = (ev / "diff_summary.md").read_text() if (ev / "diff_summary.md").exists() else ""
    return (
        f"CONTRACT\n{contract}\n\n"
        f"DIFF\n{diff}\n\n"
        f"TESTS\n{json.dumps(tests, indent=2)}\n\n"
        "Write ./.evidence/review.md starting with the VERDICT line."
    )


def _repair_user_prompt(workspace: Path, tests: list[dict[str, Any]]) -> str:
    ev = workspace / ".evidence"
    review = (ev / "review.md").read_text() if (ev / "review.md").exists() else ""
    return (
        f"REVIEW\n{review}\n\n"
        f"LATEST_TESTS\n{json.dumps(tests, indent=2)}\n\n"
        "Address every blocking issue listed in review.md, re-run tests,"
        " then write ./.evidence/repair_done.md."
    )


def _summary(res: ClaudeResult) -> dict[str, Any]:
    return {
        "role": res.role,
        "ok": res.ok,
        "exit_code": res.exit_code,
        "duration_s": res.duration_s,
        "input_tokens": res.input_tokens,
        "output_tokens": res.output_tokens,
        "cost_usd": res.cost_usd,
        "auth_mode": res.auth_mode,
        "error": res.error,
        "text_head": (res.text or "")[:400],
    }


def _parse_verdict(review_path: Path) -> str | None:
    if not review_path.exists():
        return None
    return _parse_verdict_from_text(review_path.read_text(encoding="utf-8"))


def _parse_verdict_from_text(text: str) -> str | None:
    if not text:
        return None
    first = text.strip().splitlines()[0].strip()
    if not first.startswith("VERDICT:"):
        return None
    val = first.split(":", 1)[1].strip().upper()
    if val in {"PASS", "FAIL", "NEEDS_REPAIR", "NEEDS_HUMAN"}:
        return val
    return None
