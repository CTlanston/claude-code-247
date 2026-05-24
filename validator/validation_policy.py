"""Apply the multi-validator policy.

Per spec §9.5 ("Auto-Merge Validator Rule"):
    Gemini must PASS
    OpenAI-compatible judge must PASS
    No disagreement
    No evidence gaps marked blocking
    CI must pass
    Risk policy must pass

If the two validators disagree, the task transitions to
``waiting_for_approval`` and the operator gets notified.

This module returns a structured ``ValidationOutcome`` so the dispatcher
can map it onto the task state machine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from orchestrator.config import load_config
from validator import gemini_judge, openai_judge
from validator.judge_contract import JudgeInput, JudgeResult, VERDICTS


@dataclass
class ValidationOutcome:
    ok_for_auto_merge: bool
    needs_human: bool
    final_verdict: str                    # PASS | FAIL | NEEDS_HUMAN | DISAGREE
    results: list[JudgeResult] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ok_for_auto_merge": self.ok_for_auto_merge,
            "needs_human": self.needs_human,
            "final_verdict": self.final_verdict,
            "results": [r.to_dict() for r in self.results],
            "reasons": list(self.reasons),
        }


JudgeFn = Callable[[JudgeInput], JudgeResult]


def validate(
    inp: JudgeInput,
    *,
    gemini: JudgeFn | None = None,
    openai: JudgeFn | None = None,
    extra_judges: list[JudgeFn] | None = None,
) -> ValidationOutcome:
    """Run the configured validators and apply the agreement rule.

    Defaults call the real adapters which themselves fall back to the
    mock when no API key is configured — so the function is always
    safe to call.

    M15: ``extra_judges`` lets the caller plug additional validators
    (≥3 total). The agreement rule is uniform — every enabled judge
    must return the same verdict.
    """
    cfg = load_config()
    enabled_gem = bool(cfg.get("validators.gemini.enabled", True))
    enabled_op = bool(cfg.get("validators.openai.enabled", True))
    # M15: prefer the new min_validators int; fall back to old boolean.
    min_validators = cfg.get("validators.min_validators")
    if min_validators is None:
        min_validators = 2 if bool(
            cfg.get("validators.require_two_validators", True)
        ) else 1
    min_validators = max(1, int(min_validators))

    results: list[JudgeResult] = []
    reasons: list[str] = []

    if enabled_gem:
        gem_fn = gemini or (lambda i: gemini_judge.judge(
            i, model=cfg.get("validators.gemini.model", gemini_judge.DEFAULT_MODEL)
        ))
        results.append(gem_fn(inp))
    if enabled_op:
        op_fn = openai or (lambda i: openai_judge.judge(
            i, model=cfg.get("validators.openai.model", openai_judge.DEFAULT_MODEL)
        ))
        results.append(op_fn(inp))
    for fn in (extra_judges or []):
        results.append(fn(inp))

    # No validators configured.
    if not results:
        reasons.append("no validators enabled in config")
        return ValidationOutcome(False, True, "NEEDS_HUMAN", results, reasons)

    if len(results) < min_validators:
        reasons.append(
            f"min_validators={min_validators} but only {len(results)} ran"
        )
        return ValidationOutcome(False, True, "NEEDS_HUMAN", results, reasons)

    verdicts = {r.verdict for r in results}
    if len(verdicts) > 1:
        reasons.append(f"validators disagree: {[(r.validator, r.verdict) for r in results]}")
        return ValidationOutcome(False, True, "DISAGREE", results, reasons)

    only = next(iter(verdicts))
    if only == "PASS":
        if any(r.evidence_gaps for r in results):
            gaps = sum((r.evidence_gaps for r in results), [])
            reasons.append(f"PASS but with evidence gaps flagged: {gaps}")
            return ValidationOutcome(False, True, "NEEDS_HUMAN", results, reasons)
        # M18-P1: mock validators cannot silently satisfy auto-merge.
        mock_names = [r.validator for r in results
                       if r.validator.endswith("-mock")]
        allow_mock = bool(cfg.get(
            "validators.allow_mock_validators_for_auto_merge", False))
        if mock_names and not allow_mock:
            reasons.append(
                f"PASS but mock validators present: {mock_names}; "
                "validators.allow_mock_validators_for_auto_merge=false "
                "→ routing to approval"
            )
            return ValidationOutcome(False, True, "NEEDS_HUMAN", results, reasons)
        # Per-validator require_real_for_auto_merge: if a validator is
        # configured to require real mode but its result was mock, block.
        for r in results:
            kind = r.validator.removesuffix("-mock")
            if (r.validator.endswith("-mock")
                and bool(cfg.get(f"validators.{kind}.require_real_for_auto_merge", False))):
                reasons.append(
                    f"validators.{kind}.require_real_for_auto_merge=true "
                    f"but {r.validator} ran → routing to approval"
                )
                return ValidationOutcome(False, True, "NEEDS_HUMAN", results, reasons)
        reasons.append("all validators PASS, no disagreement, no mock")
        return ValidationOutcome(True, False, "PASS", results, reasons)
    if only == "FAIL":
        reasons.append("all validators FAIL")
        return ValidationOutcome(False, False, "FAIL", results, reasons)
    # only == NEEDS_HUMAN
    reasons.append("all validators NEEDS_HUMAN")
    return ValidationOutcome(False, True, "NEEDS_HUMAN", results, reasons)


# Sanity check for downstream consumers: VERDICTS is the canonical list of
# per-validator verdicts; ValidationOutcome.final_verdict adds DISAGREE.
assert set(VERDICTS) == {"PASS", "FAIL", "NEEDS_HUMAN"}
