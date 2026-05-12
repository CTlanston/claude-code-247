"""codex_reviewer — Track R (Cycle 15 rewrite, ADR-0008).

Cross-model second-opinion reviewer using the local Codex CLI, wrapped
by `scripts/codex_budget_guard.sh` for cost discipline. Returns a
structured `CodexReview` with verdict, findings, token count, and
duration.

Constraints (L7 §0 + ADR-0008):
- Codex CLI is permitted ONLY via the budget-guard wrapper
- Daily/per-call caps live in HUMAN_CONFIG; this module reads them
- On guard refusal (exit 2): verdict="skipped", reason="budget"; cycle
  continues with single-Claude fallback
- On codex failure (exit != 0 and != 2): verdict="error"; log raw
  output to `cycles/<id>/codex-raw.log` if a cycle_id is given
- NEVER calls codex directly; always through the guard
- NEVER raises in the caller's hot path — all failures are structured
  return values

Schema (matches kickoff §1.3):

    {
      "source": "codex",
      "model": "gpt-5.4",
      "verdict": "approve" | "request_changes" | "reject" | "skipped" | "error",
      "findings": [{"severity": ..., "category": ..., "message": ...}],
      "tokens": int,
      "duration_s": int,
      "reason": str   # optional; e.g. "budget" or error description
    }
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Sequence


REPO_ROOT = Path(__file__).resolve().parent.parent
GUARD_SCRIPT = REPO_ROOT / "scripts" / "codex_budget_guard.sh"

DEFAULT_TIMEOUT_SECONDS = 180  # generous; codex review can be slow
DEFAULT_MODEL = "gpt-5.4"      # informational only; actual model is in codex config


# --- Data classes ----------------------------------------------------------


@dataclass
class CodexFinding:
    severity: str            # critical | high | medium | low
    category: str            # tdd | scope | production-risk | safety | tests | other
    message: str


@dataclass
class CodexReview:
    source: str = "codex"
    model: str = DEFAULT_MODEL
    verdict: str = "skipped"           # approve | request_changes | reject |
                                        # skipped | error
    findings: List[CodexFinding] = field(default_factory=list)
    tokens: int = 0
    duration_s: int = 0
    reason: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


# Backward-compat alias used by older callers (Cycle 7 era)
CodexVerdict = CodexReview


# --- Availability check ----------------------------------------------------


def codex_available() -> bool:
    """True iff `codex` is resolvable on PATH AND the guard script is
    present + executable. The combined check is what compute_level R-L4
    relies on."""
    if shutil.which("codex") is None:
        return False
    if not GUARD_SCRIPT.exists() or not os.access(GUARD_SCRIPT, os.X_OK):
        return False
    return True


# --- Main entry point ------------------------------------------------------


def run_codex_review(commit_sha: Optional[str] = None,
                     uncommitted: bool = False,
                     base_branch: Optional[str] = None,
                     prompt: Optional[str] = None,
                     timeout: int = DEFAULT_TIMEOUT_SECONDS,
                     cycle_id: Optional[str] = None,
                     guard_script: Optional[Path] = None) -> CodexReview:
    """Invoke `codex review ...` via the budget guard.

    Exactly one of {commit_sha, uncommitted, base_branch} should be set.
    If none, defaults to --uncommitted (most useful for in-flight cycles).

    Returns a CodexReview. Never raises — all failure modes become
    structured `verdict` values.
    """
    if not codex_available():
        return CodexReview(verdict="skipped", reason="codex_unavailable")

    guard = guard_script or GUARD_SCRIPT
    args = _build_review_args(commit_sha, uncommitted, base_branch, prompt)
    cmd = ["bash", str(guard), "review", *args]

    try:
        result = subprocess.run(
            cmd, text=True, capture_output=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return CodexReview(verdict="error", reason=f"timeout after {timeout}s")
    except FileNotFoundError as e:
        return CodexReview(verdict="skipped", reason=f"guard_or_codex_missing: {e}")

    # Exit 2 = guard refused due to daily cap
    if result.returncode == 2:
        return CodexReview(verdict="skipped", reason="budget")

    raw_output = result.stdout + (result.stderr or "")

    # If the cycle gave us an id, persist raw output for diagnostics
    if cycle_id:
        raw_log = REPO_ROOT / "cycles" / cycle_id / "codex-raw.log"
        try:
            raw_log.parent.mkdir(parents=True, exist_ok=True)
            raw_log.write_text(raw_output)
        except OSError:
            pass  # diagnostics best-effort

    # Codex's own non-zero exit
    if result.returncode != 0:
        review = _parse_review_output(raw_output)
        review.verdict = "error"
        review.reason = f"codex_exit={result.returncode}"
        return review

    review = _parse_review_output(raw_output)
    return review


def _build_review_args(commit_sha: Optional[str],
                       uncommitted: bool,
                       base_branch: Optional[str],
                       prompt: Optional[str]) -> List[str]:
    args: List[str] = []
    if commit_sha:
        args.extend(["--commit", commit_sha])
    elif base_branch:
        args.extend(["--base", base_branch])
    else:
        args.append("--uncommitted")
    if prompt:
        args.append(prompt)
    return args


# --- Output parsing --------------------------------------------------------


_TOKENS_LINE_RE = re.compile(r"tokens\s+used\s*\n\s*([\d,]+)",
                              re.IGNORECASE)
_TOKENS_ALT_RE = re.compile(r"([\d,]+)\s+tokens(?:\s+used)?", re.IGNORECASE)
_DURATION_RE = re.compile(r"duration[_ ]?s\s*[:=]\s*(\d+)", re.IGNORECASE)
_VERDICT_LINE_RE = re.compile(r"verdict\s*[:=]\s*(\w+)", re.IGNORECASE)


def _parse_review_output(text: str) -> CodexReview:
    """Best-effort parse of codex's review output. Captures tokens,
    verdict, and any findings the output advertises. Falls back to
    verdict="unknown" if the output is opaque."""
    tokens = _extract_tokens(text)
    duration = _extract_duration(text)
    verdict = _extract_verdict(text)
    findings = _extract_findings(text)
    review = CodexReview(
        verdict=verdict,
        findings=findings,
        tokens=tokens,
        duration_s=duration,
    )
    return review


def _extract_tokens(text: str) -> int:
    m = _TOKENS_LINE_RE.search(text)
    if not m:
        m = _TOKENS_ALT_RE.search(text)
    if m:
        try:
            return int(m.group(1).replace(",", ""))
        except (ValueError, IndexError):
            return 0
    return 0


def _extract_duration(text: str) -> int:
    m = _DURATION_RE.search(text)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return 0
    return 0


def _extract_verdict(text: str) -> str:
    m = _VERDICT_LINE_RE.search(text)
    if m:
        v = m.group(1).strip().lower()
        if v in {"approve", "reject", "request_changes", "skipped",
                 "error", "unknown"}:
            return v
        if v in {"approved"}:
            return "approve"
        if v in {"rejected"}:
            return "reject"
        if v in {"changes", "request", "comment", "comments"}:
            return "request_changes"
    # Heuristic fallback
    lowered = text.lower()
    if re.search(r"\breject(ed)?\b|\brequest[_ ]?changes?\b", lowered):
        return "reject"
    if re.search(r"\bapprove(d)?\b", lowered):
        return "approve"
    return "unknown"


_SEVERITY_LINE_RE = re.compile(
    r"\b(critical|high|medium|low)\s*[:\-]\s*(.+?)(?=\n|$)",
    re.IGNORECASE,
)


def _extract_findings(text: str) -> List[CodexFinding]:
    """Pull out severity-tagged finding lines.

    Looks for patterns like "HIGH: SQL injection risk" or
    "medium - missing test for empty list". Best-effort.
    """
    findings: List[CodexFinding] = []
    for m in _SEVERITY_LINE_RE.finditer(text):
        sev = m.group(1).lower()
        msg = m.group(2).strip()
        # Heuristic category extraction
        cat = "other"
        msg_lower = msg.lower()
        if "test" in msg_lower or "tdd" in msg_lower:
            cat = "tests"
        elif "scope" in msg_lower or "out of" in msg_lower:
            cat = "scope"
        elif "race" in msg_lower or "deadlock" in msg_lower \
                or "production" in msg_lower or "n+1" in msg_lower:
            cat = "production-risk"
        elif "safety" in msg_lower or "security" in msg_lower \
                or "injection" in msg_lower or "leak" in msg_lower:
            cat = "safety"
        elif "tdd" in msg_lower or "test:" in msg_lower:
            cat = "tdd"
        findings.append(CodexFinding(severity=sev, category=cat, message=msg))
    return findings


# --- Disagreement protocol + alerts (carry-over from Cycle 7) -------------


def disagreement_protocol(claude_verdict: str,
                           codex_verdict: str) -> Optional[str]:
    """Return a one-line reason string if Claude and Codex disagree on
    PASS vs FAIL, else None. Skipped/error/unknown verdicts on either
    side never count as disagreement."""
    cv = (claude_verdict or "").strip().lower()
    xv = (codex_verdict or "").strip().lower()
    non_signal = {"skipped", "error", "unknown", "codex_unavailable", ""}
    if cv in non_signal or xv in non_signal:
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
