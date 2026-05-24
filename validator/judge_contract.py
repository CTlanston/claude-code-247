"""Validator contract — what gets passed in, what comes back.

Per spec §9.1: validators see ONLY the evidence package. They never see
Coder conversation context or hidden reasoning. This module defines the
typed shape of that interface so any implementation (Gemini, OpenAI,
mock) can be swapped at the policy layer.

Return schema (spec §9.4):

  {
    "verdict": "PASS" | "FAIL" | "NEEDS_HUMAN",
    "confidence": 0.0–1.0,
    "summary": "...",
    "blocking_issues": [...],
    "non_blocking_issues": [...],
    "evidence_gaps": [...],
    "recommended_next_action": "..."
  }
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

VERDICTS = ("PASS", "FAIL", "NEEDS_HUMAN")


@dataclass(frozen=True)
class JudgeInput:
    """Evidence package handed to a validator. Files are read off-disk
    so the validator never has to know about the workspace layout."""
    task_id: str
    repo_id: str
    contract: str
    plan: str | None
    worker_done: str | None
    diff_summary: str
    file_manifest: list[str]
    test_results: list[dict[str, Any]]
    lint_results: list[dict[str, Any]]
    build_results: list[dict[str, Any]]
    risk_score: dict[str, Any] | None
    reviewer_report: str | None
    ci_summary: str | None
    diff_body_safe: str | None = None
    diff_body_metadata: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_evidence_dir(
        cls, evidence_dir: Path, *, task_id: str, repo_id: str
    ) -> "JudgeInput":
        e = Path(evidence_dir)
        def _r(name: str) -> str | None:
            p = e / name
            return p.read_text(encoding="utf-8") if p.exists() else None
        def _j(name: str, default):
            p = e / name
            if not p.exists():
                return default
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return default
        return cls(
            task_id=task_id,
            repo_id=repo_id,
            contract=_r("contract.md") or "",
            plan=_r("plan.md"),
            worker_done=_r("worker_done.md"),
            diff_summary=_r("diff_summary.md") or "",
            file_manifest=_j("file_manifest.json", []),
            test_results=_j("test_results.json", []),
            lint_results=_j("lint_results.json", []),
            build_results=_j("build_results.json", []),
            risk_score=_j("risk_score.json", None),
            reviewer_report=_r("review.md"),
            ci_summary=_r("ci_summary.md"),
            diff_body_safe=_r("diff_body_safe.md"),
            diff_body_metadata=_j("diff_body_metadata.json", None),
        )


@dataclass(frozen=True)
class JudgeResult:
    validator: str            # gemini | openai | mock
    verdict: str              # PASS | FAIL | NEEDS_HUMAN
    confidence: float         # 0.0 to 1.0
    summary: str
    blocking_issues: list[str]
    non_blocking_issues: list[str]
    evidence_gaps: list[str]
    recommended_next_action: str
    raw_response: dict[str, Any] = field(default_factory=dict)
    auth_mode: str = "unknown"

    def to_dict(self) -> dict[str, Any]:
        return {
            "validator": self.validator,
            "verdict": self.verdict,
            "confidence": self.confidence,
            "summary": self.summary,
            "blocking_issues": list(self.blocking_issues),
            "non_blocking_issues": list(self.non_blocking_issues),
            "evidence_gaps": list(self.evidence_gaps),
            "recommended_next_action": self.recommended_next_action,
            "auth_mode": self.auth_mode,
        }


class JudgeError(RuntimeError):
    """Raised when a validator can't return a structured verdict."""


def normalize_response(validator: str, payload: dict[str, Any],
                       *, auth_mode: str = "unknown") -> JudgeResult:
    """Validate + coerce a raw model response into a JudgeResult.

    Models occasionally return slightly off shapes; we accept the loosest
    sensible coercion (verdict uppercased, missing lists default empty),
    but fail loudly on a missing or invalid verdict — that field is
    load-bearing for the merge policy."""
    verdict = str(payload.get("verdict", "")).strip().upper()
    if verdict not in VERDICTS:
        raise JudgeError(f"{validator}: invalid verdict {verdict!r}; expected one of {VERDICTS}")
    confidence = float(payload.get("confidence", 0.5))
    if not 0.0 <= confidence <= 1.0:
        confidence = max(0.0, min(1.0, confidence))
    return JudgeResult(
        validator=validator,
        verdict=verdict,
        confidence=confidence,
        summary=str(payload.get("summary") or ""),
        blocking_issues=list(payload.get("blocking_issues") or []),
        non_blocking_issues=list(payload.get("non_blocking_issues") or []),
        evidence_gaps=list(payload.get("evidence_gaps") or []),
        recommended_next_action=str(payload.get("recommended_next_action") or ""),
        raw_response=payload,
        auth_mode=auth_mode,
    )


def evidence_prompt(inp: JudgeInput) -> str:
    """Compose the evidence prompt the validator sees. This is the ONLY
    thing the validator gets from the task — never any conversation
    history. Stays text-only so identical prompts go to all judges."""
    # BR-001: render the safe diff body and an explicit instruction for
    # using it. When the body is absent we still emit the section so the
    # validator knows it was supposed to be there (and can route to
    # NEEDS_HUMAN) rather than silently judging on the --stat summary.
    diff_body_block = _render_diff_body_block(inp)

    diff_body_instruction = (
        "You may inspect the safe diff body (## DIFF_BODY) as implementation\n"
        "evidence. If the diff body is missing or insufficient for\n"
        "behavioral judgment, return NEEDS_HUMAN with an evidence gap\n"
        "naming what you need. Do not ask for hidden conversation context.\n"
        "Do not require full repository source if tests and the diff body\n"
        "are sufficient.\n\n"
    )

    return (
        "You are reviewing a software-engineering change. Judge ONLY from\n"
        "the evidence below. If something is missing, return NEEDS_HUMAN\n"
        "and list the gap. Do not speculate about what the implementer\n"
        "thought.\n\n"
        + diff_body_instruction
        + f"TASK_ID: {inp.task_id}\nREPO_ID: {inp.repo_id}\n\n"
        f"## CONTRACT\n{inp.contract.strip() or '(none)'}\n\n"
        f"## PLAN\n{(inp.plan or '(none)').strip()}\n\n"
        f"## WORKER_DONE\n{(inp.worker_done or '(none)').strip()}\n\n"
        f"## DIFF\n{inp.diff_summary.strip() or '(none)'}\n\n"
        + diff_body_block
        + f"## FILE_MANIFEST\n{json.dumps(inp.file_manifest)}\n\n"
        f"## TEST_RESULTS\n{json.dumps(inp.test_results, indent=2)}\n\n"
        f"## LINT_RESULTS\n{json.dumps(inp.lint_results, indent=2)}\n\n"
        f"## BUILD_RESULTS\n{json.dumps(inp.build_results, indent=2)}\n\n"
        f"## RISK_SCORE\n{json.dumps(inp.risk_score)}\n\n"
        f"## REVIEWER_REPORT\n{(inp.reviewer_report or '(none)').strip()}\n\n"
        "Return JSON with this exact schema (no markdown, no commentary):\n"
        "{\n"
        '  "verdict": "PASS" | "FAIL" | "NEEDS_HUMAN",\n'
        '  "confidence": 0.0-1.0,\n'
        '  "summary": "one paragraph",\n'
        '  "blocking_issues": ["..."],\n'
        '  "non_blocking_issues": ["..."],\n'
        '  "evidence_gaps": ["..."],\n'
        '  "recommended_next_action": "..."\n'
        "}\n"
    )


def _render_diff_body_block(inp: JudgeInput) -> str:
    body = inp.diff_body_safe
    meta = inp.diff_body_metadata or {}
    secret_status = (meta.get("secret_scan") or {}).get("status")

    if secret_status == "BLOCKED":
        # Surface the redacted state up-front so the validator doesn't
        # treat the (intentionally) thin body as if it were the full diff.
        return (
            "## DIFF_BODY\n"
            "STATE: BLOCKED — secret-like content detected; full body was\n"
            "REDACTED by the evidence collector. The merge policy will\n"
            "block this change regardless of your verdict. Treat the\n"
            "redacted summary below as the only implementation evidence\n"
            "available and respond accordingly.\n\n"
            f"{(body or '(redacted summary missing)').strip()}\n\n"
        )

    if body is None:
        return (
            "## DIFF_BODY\n"
            "(missing) — diff_body_safe.md was not produced for this\n"
            "evidence package. If you cannot judge behavioral correctness\n"
            "from the summary + tests alone, return NEEDS_HUMAN with an\n"
            "evidence_gap of 'diff_body_safe.md'.\n\n"
        )

    return f"## DIFF_BODY\n{body.strip()}\n\n"
