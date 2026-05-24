"""Merge-policy decision engine.

Given a risk assessment + validator outcome + repo merge config +
system flags, decide one of:

  AUTO_MERGE        — orchestrator may merge now
  WAITING_APPROVAL  — open approval request; medium-risk PRs land here
  BLOCKED           — high-risk or hard guardrail; require manual review

The function returns the decision PLUS a list of plain-English reasons
so the dashboard and CLI can show "why".

The hard guardrail ``system.allow_remote_writes`` is checked first:
when off, the most we ever return is WAITING_APPROVAL (so the operator
can see the intent without it actually firing).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from orchestrator.config import load_config
from orchestrator.repo_registry import RepoEntry
from orchestrator.risk_score import RiskAssessment
from validator.validation_policy import ValidationOutcome


class MergeDecision(str, Enum):
    AUTO_MERGE = "auto_merge"
    WAITING_APPROVAL = "waiting_approval"
    BLOCKED = "blocked"


@dataclass
class MergeRuling:
    decision: MergeDecision
    risk_level: str
    risk_score: int
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "decision": self.decision.value,
            "risk_level": self.risk_level,
            "risk_score": self.risk_score,
            "reasons": list(self.reasons),
        }


def decide(
    *,
    risk: RiskAssessment,
    validators: ValidationOutcome,
    repo: RepoEntry,
    ci_passed: bool | None,
    tests_passed: bool,
    lint_passed: bool,
) -> MergeRuling:
    cfg = load_config()
    reasons: list[str] = []

    # Hard guardrails first.
    if risk.level == "high":
        reasons.append(f"risk score {risk.score} is HIGH ( > medium_max ); blocked")
        return MergeRuling(MergeDecision.BLOCKED, risk.level, risk.score, reasons)

    # Forbidden-path touches are an automatic BLOCK regardless of band.
    forbidden_factor = next((f for f in risk.triggered if f.name == "forbidden_path_touch"), None)
    if forbidden_factor:
        reasons.append(f"forbidden path touched: {forbidden_factor.reason}")
        return MergeRuling(MergeDecision.BLOCKED, risk.level, risk.score, reasons)

    # Validator results must be PASS-PASS-no-gaps for auto.
    if validators.final_verdict != "PASS":
        reasons.append(f"validators: {validators.final_verdict} — {validators.reasons[-1] if validators.reasons else ''}")
        # Disagreement and gap cases route to human regardless of risk band.
        if validators.final_verdict in ("DISAGREE", "NEEDS_HUMAN"):
            return MergeRuling(MergeDecision.WAITING_APPROVAL, risk.level, risk.score, reasons)
        # FAIL → blocked (the work didn't satisfy the contract)
        return MergeRuling(MergeDecision.BLOCKED, risk.level, risk.score, reasons)

    if ci_passed is False:
        reasons.append("CI failed")
        return MergeRuling(MergeDecision.BLOCKED, risk.level, risk.score, reasons)
    if not tests_passed:
        reasons.append("local tests failed")
        return MergeRuling(MergeDecision.BLOCKED, risk.level, risk.score, reasons)
    if not lint_passed:
        # lint is non-blocking by design — but it's a reason to inspect.
        reasons.append("lint failed (non-blocking but noted)")

    # Per-repo: auto_merge.enabled must be true to auto-merge.
    am = (repo.raw or {}).get("auto_merge") or {}
    if not am.get("enabled"):
        reasons.append(f"repo {repo.id!r} auto_merge.enabled=false; routing to approval")
        return MergeRuling(MergeDecision.WAITING_APPROVAL, risk.level, risk.score, reasons)

    max_score = int(am.get("max_risk_score", 30))
    max_lines = int(am.get("max_changed_lines", 300))
    if risk.score > max_score:
        reasons.append(f"risk {risk.score} exceeds repo cap {max_score}")
        return MergeRuling(MergeDecision.WAITING_APPROVAL, risk.level, risk.score, reasons)

    # Medium risk: never auto-merge; always require approval.
    if risk.level == "medium":
        reasons.append(f"risk score {risk.score} is MEDIUM; approval required")
        return MergeRuling(MergeDecision.WAITING_APPROVAL, risk.level, risk.score, reasons)

    # System safety gate.
    if not cfg.allow_remote_writes:
        reasons.append("system.allow_remote_writes=false; would auto-merge but gated")
        return MergeRuling(MergeDecision.WAITING_APPROVAL, risk.level, risk.score, reasons)

    reasons.append("low-risk + both validators PASS + tests + CI + within repo caps")
    return MergeRuling(MergeDecision.AUTO_MERGE, risk.level, risk.score, reasons)
