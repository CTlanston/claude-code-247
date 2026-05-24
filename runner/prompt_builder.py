"""Per-role prompt assembly.

M3 ships only the skeleton; M4 plugs in actual role templates and
retrieval calls. Keeping the shape stable so M4 can swap implementation
without rewriting callers.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RolePrompt:
    role: str
    system: str
    user: str
    metadata: dict[str, object]


def build_planner_prompt(*, goal: str, repo_profile: dict, memory: list[str] | None = None,
                         allowed_paths: list[str], forbidden_paths: list[str]) -> RolePrompt:
    sys_ = (
        "You are the Planner. Produce a contract, a plan, a risk_assessment,\n"
        "and a worker_breakdown the Coder can act on. Touch nothing outside\n"
        "allowed_paths."
    )
    mem_block = "\n".join(f"- {m}" for m in (memory or [])) or "(none)"
    usr = (
        f"GOAL\n{goal}\n\n"
        f"REPO_PROFILE\n{repo_profile}\n\n"
        f"ALLOWED_PATHS\n{allowed_paths}\n\n"
        f"FORBIDDEN_PATHS\n{forbidden_paths}\n\n"
        f"RELEVANT_MEMORY\n{mem_block}\n\n"
        "Required outputs:\n"
        "- plan.md\n- contract.md\n- risk_assessment.md\n- worker_breakdown.md"
    )
    return RolePrompt("planner", sys_, usr, {"repo_id": repo_profile.get("id")})


def build_coder_prompt(*, contract: str, repo_profile: dict, memory: list[str] | None = None,
                       allowed_paths: list[str], forbidden_paths: list[str],
                       style_guide: str | None = None) -> RolePrompt:
    sys_ = (
        "You are the Coder. Execute the contract. Touch nothing outside allowed_paths.\n"
        "Write tests for every code change. Emit worker_done.md when finished."
    )
    usr = (
        f"CONTRACT\n{contract}\n\n"
        f"REPO_PROFILE\n{repo_profile}\n\n"
        f"ALLOWED_PATHS\n{allowed_paths}\n\n"
        f"FORBIDDEN_PATHS\n{forbidden_paths}\n\n"
        f"STYLE_GUIDE\n{style_guide or '(none)'}\n\n"
        f"RELEVANT_MEMORY\n{memory or '(none)'}\n"
    )
    return RolePrompt("coder", sys_, usr, {"repo_id": repo_profile.get("id")})


def build_reviewer_prompt(*, contract: str, diff_summary: str, test_results: str,
                          risk_score: dict) -> RolePrompt:
    sys_ = (
        "You are the Reviewer. You do NOT see the Coder's conversation. Judge ONLY\n"
        "the evidence below. Return PASS / FAIL / NEEDS_REPAIR / NEEDS_HUMAN."
    )
    usr = (
        f"CONTRACT\n{contract}\n\n"
        f"DIFF\n{diff_summary}\n\n"
        f"TESTS\n{test_results}\n\n"
        f"RISK\n{risk_score}\n"
    )
    return RolePrompt("reviewer", sys_, usr, {})
