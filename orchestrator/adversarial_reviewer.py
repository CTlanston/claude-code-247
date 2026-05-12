"""adversarial_reviewer — Track R6 (Cycle 19).

Third independent reviewer for the _do_review pass: a single-purpose
Claude Code subagent that answers ONE question — "how does this change
break in production?" — independent of the main Reviewer and Codex.

The subagent's system prompt lives at `runner/roles/adversarial_reviewer.md`
(see that file for the full contract). This module is the Python adapter
that invokes the subagent via `runner.run_role("adversarial_reviewer", ...)`
and translates the result into a structured `AdversarialReview`.

Like Codex, adversarial is an OBSERVER — Claude's verdict remains
decisive. On Claude=APPROVE + Adversarial=REJECT, `_do_review` writes
ALERT.md; it does NOT auto-flip Claude's verdict.

The module deliberately mirrors `codex_reviewer.py`'s shape so the
calling code in main.py has parallel patterns.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional

try:
    # Available when imported via orchestrator package context
    from . import runner  # type: ignore
except ImportError:
    # Standalone import (tests sys.path.insert(orchestrator))
    import runner  # type: ignore


REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class AdversarialFinding:
    category: str            # race | trust | silent_loss | leak | n_plus_1 |
                             # auth | incompat | idempotency | toctou | boundary
    message: str
    file: str = ""
    line: int = 0


@dataclass
class AdversarialReview:
    source: str = "adversarial"
    verdict: str = "unknown"             # approve | request_changes | reject |
                                          # skipped | error | unknown
    summary: str = ""
    findings: List[AdversarialFinding] = field(default_factory=list)
    reason: Optional[str] = None         # set on error / skipped

    def to_dict(self) -> dict:
        return asdict(self)


# --- Public API ----------------------------------------------------------


def run_adversarial_review(task: dict, issue_id: int) -> AdversarialReview:
    """Invoke the adversarial reviewer subagent for `task`.

    NEVER raises. All failure modes become structured `verdict` values.
    """
    branch = task.get("branch", "")
    prompt = (
        f"Adversarial review of branch {branch} (issue #{issue_id}). "
        f"Find production failure modes the main Reviewer and Codex may "
        f"have missed. Output result.json per the role-prompt schema."
    )
    try:
        out = runner.run_role("adversarial_reviewer", issue_id, prompt)
    except Exception as e:  # noqa: BLE001
        return AdversarialReview(verdict="error", reason=str(e))

    if not isinstance(out, dict):
        return AdversarialReview(verdict="error",
                                  reason=f"unexpected runner output type: "
                                         f"{type(out).__name__}")

    result = out.get("result") or {}
    verdict = (result.get("verdict") or "unknown").strip().lower()
    if verdict not in {"approve", "request_changes", "reject",
                        "skipped", "error", "unknown"}:
        verdict = "unknown"

    findings: List[AdversarialFinding] = []
    for c in (result.get("comments") or []):
        if not isinstance(c, dict):
            continue
        findings.append(AdversarialFinding(
            category=str(c.get("category") or "other"),
            message=str(c.get("msg") or c.get("message") or ""),
            file=str(c.get("file") or ""),
            line=int(c.get("line") or 0),
        ))

    return AdversarialReview(
        verdict=verdict,
        summary=str(result.get("summary") or ""),
        findings=findings,
    )


# --- Disagreement helper -------------------------------------------------


def adversarial_disagreement(claude_verdict: str,
                              adv_verdict: str) -> Optional[str]:
    """Return a one-line escalation reason iff Claude approved AND
    Adversarial rejected. All other combinations are NOT a disagreement.

    The asymmetry is deliberate: adversarial review is a one-way safety
    check. If adversarial says approve while Claude says reject, that's
    Claude doing its job — no escalation. Only adversarial-catches-what-
    Claude-missed warrants ALERT.md."""
    cv = (claude_verdict or "").strip().lower()
    av = (adv_verdict or "").strip().lower()
    if av in {"skipped", "error", "unknown", ""}:
        return None
    claude_passes = "approve" in cv
    adv_rejects = "reject" in av or "request_changes" in av
    if claude_passes and adv_rejects:
        return (f"Adversarial reviewer rejected a Claude-approved PR. "
                f"Claude verdict={claude_verdict!r}, "
                f"Adversarial verdict={adv_verdict!r}. Per L7 §7 the "
                "cycle must NOT auto-resolve — escalate to human review.")
    return None
