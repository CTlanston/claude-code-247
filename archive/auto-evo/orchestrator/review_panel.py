"""review_panel — Track R7 (Cycle 21).

N-of-3 reviewer panel that aggregates the three reviewer verdicts
(Claude main + Codex + Adversarial) into a structured `PanelVerdict`
with disagreement-as-signal classification.

Per L7 §7: when reviewers disagree on pass/fail, the cycle does NOT
auto-resolve — the human is escalated via ALERT.md. This module
encapsulates the aggregation logic so the orchestrator's `_do_review`
can use one call instead of three independent ALERT checks.

Pure-function design: `n_of_3()` returns a `PanelVerdict` without
side effects. The companion `disagreement_escalate()` is the explicit
side-effect wrapper that writes ALERT.md when the panel says so.

Vote normalisation:
- approve            → PASS
- reject             → FAIL
- request_changes    → FAIL (treated as same class as reject for
                         agreement counting; the orchestrator can
                         still display them differently)
- skipped, error, unknown, codex_unavailable, ""
                     → ABSTENTION (not a vote, doesn't count toward
                         agree_count, can't trigger disagreement)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple


_PASS_VERDICTS = {"approve", "approved", "pass", "passing"}
_FAIL_VERDICTS = {"reject", "rejected", "request_changes",
                   "request-changes", "fail", "failing"}
_ABSTENTION = {"skipped", "error", "unknown", "codex_unavailable",
                "", None}


@dataclass
class PanelVerdict:
    overall: str                 # approve | request_changes | reject |
                                  # disagreement | unknown
    votes: Dict[str, str] = field(default_factory=dict)
    agree_count: int = 0          # how many non-abstaining voters
                                   # reached the consensus class
    disagreement_summary: Optional[str] = None
    escalate: bool = False


def _classify(verdict: str) -> str:
    """Return one of: 'pass', 'fail', 'abstain' for the verdict string."""
    if verdict is None:
        return "abstain"
    v = str(verdict).strip().lower()
    if v in _PASS_VERDICTS:
        return "pass"
    if v in _FAIL_VERDICTS:
        return "fail"
    if v in _ABSTENTION:
        return "abstain"
    # Unknown verdict shape → treat as abstain (don't escalate on garbage)
    return "abstain"


def n_of_3(claude_verdict: str,
           codex_verdict: str,
           adv_verdict: str) -> PanelVerdict:
    """Aggregate three reviewer verdicts into a PanelVerdict.

    Decision rules:
    - Unanimous PASS → overall=approve, escalate=False
    - Unanimous FAIL → overall=reject (or request_changes if any voter
        used that form), escalate=False
    - Mixed PASS/FAIL among non-abstainers → escalate=True;
        overall=disagreement (if PASS majority) or request_changes
        (if FAIL majority)
    - All abstain → overall=unknown, escalate=False
    - One voter, two abstain → degrade to that voter's verdict;
        escalate=False (single-voice; no disagreement possible)
    """
    votes = {
        "claude": (claude_verdict or "").strip().lower(),
        "codex": (codex_verdict or "").strip().lower(),
        "adversarial": (adv_verdict or "").strip().lower(),
    }
    classes = {name: _classify(v) for name, v in votes.items()}
    pass_voters = [n for n, c in classes.items() if c == "pass"]
    fail_voters = [n for n, c in classes.items() if c == "fail"]
    abstain_voters = [n for n, c in classes.items() if c == "abstain"]

    n_pass = len(pass_voters)
    n_fail = len(fail_voters)
    n_active = n_pass + n_fail

    # All abstain → unknown
    if n_active == 0:
        return PanelVerdict(overall="unknown", votes=votes,
                             agree_count=0, disagreement_summary=None,
                             escalate=False)

    # Consensus (all active voters agree)
    if n_fail == 0:
        # Pure PASS among non-abstainers
        return PanelVerdict(overall="approve", votes=votes,
                             agree_count=n_pass,
                             disagreement_summary=None,
                             escalate=False)
    if n_pass == 0:
        # Pure FAIL among non-abstainers; prefer request_changes if
        # any voter used that form, else reject
        used_request_changes = any(
            votes[n] in ("request_changes", "request-changes")
            for n in fail_voters
        )
        overall = "request_changes" if used_request_changes else "reject"
        return PanelVerdict(overall=overall, votes=votes,
                             agree_count=n_fail,
                             disagreement_summary=None,
                             escalate=False)

    # Disagreement: at least one PASS AND at least one FAIL
    if n_pass >= n_fail:
        # PASS majority but at least one dissenter — escalate, the
        # dissenter may have caught a real production issue
        overall = "disagreement"
    else:
        # FAIL majority — request_changes (still don't auto-merge)
        overall = "request_changes"

    summary = (
        f"Panel disagreement: {n_pass}/{n_active} approve "
        f"({', '.join(sorted(pass_voters))}), "
        f"{n_fail}/{n_active} reject "
        f"({', '.join(sorted(fail_voters))})"
    )
    if abstain_voters:
        summary += f"; abstained: {', '.join(sorted(abstain_voters))}"

    return PanelVerdict(
        overall=overall, votes=votes,
        agree_count=max(n_pass, n_fail),
        disagreement_summary=summary,
        escalate=True,
    )


def disagreement_escalate(panel: PanelVerdict,
                           alert_path: Path) -> bool:
    """Side-effect wrapper. Writes a structured entry to ALERT.md iff
    `panel.escalate` is True. Returns True if a write happened.

    The ALERT body includes the panel summary, all three votes, and
    a timestamp. Append-only; existing ALERT content is preserved."""
    if not panel.escalate:
        return False
    timestamp = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
    body = (
        f"\n## PANEL ALERT @ {timestamp}\n\n"
        f"{panel.disagreement_summary or 'panel disagreement'}\n\n"
        f"Votes:\n"
        f"  - claude: {panel.votes.get('claude','?')}\n"
        f"  - codex: {panel.votes.get('codex','?')}\n"
        f"  - adversarial: {panel.votes.get('adversarial','?')}\n\n"
        f"Overall: {panel.overall}\n"
        f"Per L7 §7 the cycle MUST NOT auto-resolve — human review required.\n"
    )
    if alert_path.exists():
        existing = alert_path.read_text(errors="replace")
        alert_path.write_text(existing + body)
    else:
        alert_path.write_text(f"# ALERT.md — escalation signals\n{body}")
    return True
