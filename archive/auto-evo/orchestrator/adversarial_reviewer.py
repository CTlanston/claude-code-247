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


# Track S5 (Cycle 34): subagent-return whitelist.
#
# These are the 10 categories the `runner/roles/adversarial_reviewer.md`
# role prompt instructs the subagent to use, plus "other" as the canonical
# fallback for anything that doesn't match. Categories outside this set
# get silently remapped to "other" by `run_adversarial_review`, which
# guards against subagent prompt drift or prompt-injection that smuggles
# unexpected category strings into downstream consumers.
#
# Exported as a tuple (immutable) so callers can introspect without
# being able to mutate the whitelist at runtime.
KNOWN_FINDING_CATEGORIES: tuple = (
    "race", "trust", "silent_loss", "leak", "n_plus_1",
    "auth", "incompat", "idempotency", "toctou", "boundary",
    "other",
)
_KNOWN_FINDING_CATEGORIES = frozenset(KNOWN_FINDING_CATEGORIES)

# Mirrors the verdict whitelist already used inside run_adversarial_review.
_KNOWN_VERDICTS = frozenset({
    "approve", "request_changes", "reject",
    "skipped", "error", "unknown",
})


@dataclass
class AdversarialFinding:
    category: str            # one of KNOWN_FINDING_CATEGORIES (see above)
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
        # Track S5 (Cycle 34): silently remap unknown categories to
        # "other". The subagent's role prompt declares 10 categories;
        # anything outside that set is treated as a contract violation
        # and stored as "other" so downstream consumers don't see
        # surprise strings.
        raw_cat = str(c.get("category") or "other").strip().lower()
        cat = raw_cat if raw_cat in _KNOWN_FINDING_CATEGORIES else "other"
        findings.append(AdversarialFinding(
            category=cat,
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


# --- Return-check (Track S5, Cycle 34) ---------------------------------


def validate_adversarial_review_contract(
    review: AdversarialReview,
) -> List[str]:
    """Return a list of contract-violation strings (empty when the
    review matches the documented schema). Use this at the boundary
    between subagent output and downstream consumers to detect drift,
    prompt-injection, or schema bugs in the adapter.

    The function does NOT raise and does NOT mutate the review; it is
    a pure inspector. Empty findings lists are allowed (an adversarial
    pass with nothing to flag is valid).
    """
    violations: List[str] = []
    if review.source != "adversarial":
        violations.append(
            f"source must equal 'adversarial' (got {review.source!r})"
        )
    verdict_lc = (review.verdict or "").strip().lower()
    if verdict_lc not in _KNOWN_VERDICTS:
        violations.append(
            f"verdict {review.verdict!r} is not one of "
            f"{sorted(_KNOWN_VERDICTS)}"
        )
    for i, f in enumerate(review.findings or []):
        cat = (f.category or "").strip().lower()
        if cat not in _KNOWN_FINDING_CATEGORIES:
            violations.append(
                f"findings[{i}].category {f.category!r} is not in the "
                f"known set {sorted(_KNOWN_FINDING_CATEGORIES)}"
            )
        if not (f.message or "").strip():
            violations.append(
                f"findings[{i}].message is empty (every finding must "
                f"carry an explanation)"
            )
    return violations
