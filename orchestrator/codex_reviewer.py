"""codex_reviewer — Track R2 (L7 §6).

Cross-model second-opinion reviewer using the user's locally installed
Codex CLI (subscription auth, NOT a paid API key). When Codex disagrees
with Claude on a PASS/FAIL verdict, write ALERT.md and DO NOT
auto-resolve — escalate to the human.

Constraints (L7 §0):
- NEVER call the Codex paid API endpoint
- NEVER set OPENAI_API_KEY
- Use only the local `codex` CLI binary, which uses the user's own
  subscription auth file (typically `~/.codex/...`)
- Strict timeout to avoid hangs
- If `codex` is not on PATH: return verdict="codex_unavailable" and
  skip the call entirely

Typical usage:

    verdict = run_codex_review(diff_text, prompt_path=Path("reviewer.md"))
    if verdict.available:
        reason = disagreement_protocol(claude_verdict, verdict.verdict)
        if reason:
            write_alert(reason, Path("ALERT.md"))
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


DEFAULT_TIMEOUT_SECONDS = 120


@dataclass
class CodexVerdict:
    available: bool                  # codex was on PATH AND ran
    verdict: str                     # "approve" | "reject" | "request_changes"
                                     # | "codex_unavailable" | "codex_error"
    raw_output: str = ""
    error: Optional[str] = None


def codex_available() -> bool:
    """True if the `codex` CLI is resolvable on PATH."""
    return shutil.which("codex") is not None


def run_codex_review(diff: str,
                      prompt_path: Optional[Path] = None,
                      timeout: int = DEFAULT_TIMEOUT_SECONDS) -> CodexVerdict:
    """Shell out to Codex CLI for an independent review of `diff`.

    When `codex` is missing from PATH, returns immediately with
    verdict="codex_unavailable" — no subprocess invocation, no spend
    risk. Callers should check `verdict.available` before relying on
    `verdict.verdict`.

    The prompt file (if given) is appended to a stable reviewer prompt
    so Codex has the same checklist Claude was given. If None, we use
    a built-in minimal reviewer prompt.
    """
    if not codex_available():
        return CodexVerdict(available=False, verdict="codex_unavailable",
                            raw_output="", error=None)

    reviewer_prompt = _build_reviewer_prompt(prompt_path)
    full_input = f"{reviewer_prompt}\n\n---\n\n## Diff\n\n{diff}\n"

    try:
        result = subprocess.run(
            ["codex", "--print"],          # Codex CLI: print-mode = non-interactive
            input=full_input,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return CodexVerdict(available=True, verdict="codex_error",
                             raw_output="",
                             error=f"timeout after {timeout}s")
    except FileNotFoundError as e:
        # Race: codex disappeared between availability check and invocation
        return CodexVerdict(available=False, verdict="codex_unavailable",
                             raw_output="", error=str(e))

    if result.returncode != 0:
        return CodexVerdict(available=True, verdict="codex_error",
                             raw_output=result.stdout,
                             error=(result.stderr or "").strip()
                                   or f"exit={result.returncode}")

    parsed = _parse_codex_verdict(result.stdout)
    return CodexVerdict(available=True, verdict=parsed,
                         raw_output=result.stdout, error=None)


_APPROVE_RE = re.compile(r"\bapprove\b", re.IGNORECASE)
_REJECT_RE = re.compile(r"\b(reject|request[_ ]?changes?)\b", re.IGNORECASE)


def _parse_codex_verdict(text: str) -> str:
    """Heuristic verdict extraction from Codex's free-text output."""
    lowered = text.lower()
    # Prefer explicit "verdict: ..." line
    m = re.search(r"verdict\s*:\s*(\w+)", lowered)
    if m:
        return m.group(1).strip()
    # Otherwise: detect first approve/reject mention
    if _REJECT_RE.search(lowered):
        return "reject"
    if _APPROVE_RE.search(lowered):
        return "approve"
    return "unknown"


def _build_reviewer_prompt(prompt_path: Optional[Path]) -> str:
    """Concatenate the L7 stable reviewer prompt with any extra file."""
    base = (
        "You are an independent code reviewer running as a second opinion.\n"
        "Read the diff that follows. Output exactly one final line of the form\n"
        "  verdict: approve\n"
        "  verdict: reject\n"
        "  verdict: request_changes\n"
        "based solely on safety and TDD intent (V4 softened: at least one\n"
        "test commit before at least one impl commit). Do NOT propose\n"
        "alternative implementations.\n"
    )
    if prompt_path and prompt_path.exists():
        try:
            base += "\n\n" + prompt_path.read_text(errors="replace")
        except OSError:
            pass
    return base


def disagreement_protocol(claude_verdict: str,
                           codex_verdict: str) -> Optional[str]:
    """Return a one-line reason string if Claude and Codex disagree on
    PASS vs FAIL, else None. Codex unavailability is NEVER a disagreement."""
    cv = (claude_verdict or "").strip().lower()
    xv = (codex_verdict or "").strip().lower()
    if xv in {"codex_unavailable", "codex_error", "unknown", ""}:
        return None
    claude_passes = "approve" in cv or "pass" in cv
    codex_passes = "approve" in xv or "pass" in xv
    if claude_passes == codex_passes:
        return None
    return (f"Cross-model disagreement: Claude verdict={claude_verdict!r}, "
            f"Codex verdict={codex_verdict!r}. Per L7 §7 protocol the cycle "
            "must NOT auto-resolve — escalate to human review.")


def write_alert(reason: str, alert_path: Path) -> None:
    """Append a timestamped disagreement entry to ALERT.md."""
    timestamp = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
    block = (
        f"\n## ALERT @ {timestamp}\n"
        f"\n{reason}\n"
    )
    if alert_path.exists():
        existing = alert_path.read_text(errors="replace")
        alert_path.write_text(existing + block)
    else:
        alert_path.write_text(f"# ALERT.md — escalation signals\n{block}")
