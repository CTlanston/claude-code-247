"""intake_sanitizer — Track S3 (L7 §6).

Scans issue titles + bodies for prompt-injection patterns BEFORE the
inner engine dispatches Planner/Coder/Reviewer. Returns a structured
`SanitizationResult` with redacted clean text and a list of flagged
spans.

The scanner is intentionally rule-based, conservative, and over-flags
rather than under-flags. The redaction is a `[REDACTED:<category>]`
marker so any downstream LLM sees that something was stripped without
seeing the original injection content.

Pattern categories:
- prompt_injection: "ignore previous", "please approve", auto-approve
- impersonation: "as the reviewer", "as a code reviewer"
- role_confusion: "## System", "system:", "you are now"
- dangerous_command: backticked `rm -rf`, `curl ... | sh`
- unsafe_uri: javascript:, data:, file://
- hidden_unicode: U+E0000–U+E007F (Unicode tag chars)

Risk score 0-100 (clamped) is a heuristic sum:
- prompt_injection         +20
- impersonation            +15
- role_confusion           +15
- dangerous_command        +40
- unsafe_uri               +10
- hidden_unicode           +20
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List


@dataclass
class FlaggedSpan:
    category: str
    match_text: str       # the original offending substring (NOT shown to LLM)
    start: int
    end: int
    field: str            # "title" | "body"


@dataclass
class SanitizationResult:
    clean_title: str
    clean_body: str
    flagged_spans: List[FlaggedSpan] = field(default_factory=list)
    risk_score: int = 0


# --- Patterns --------------------------------------------------------------


_PATTERNS = [
    # category, regex, score-weight
    ("prompt_injection", re.compile(
        r"(?i)\b(ignore (all )?previous (instructions|prompts?))\b"
        r"|\b(disregard (all )?previous)\b",
    ), 20),
    ("prompt_injection", re.compile(
        r"(?i)\b(please\s+approve|auto[-\s]?approve|you\s+must\s+approve)\b",
    ), 20),
    ("prompt_injection", re.compile(
        r"(?i)\b(trust\s+this|the\s+correct\s+fix\s+is)\b",
    ), 15),
    ("impersonation", re.compile(
        r"(?i)\bas\s+(the|a)\s+(code\s+)?reviewer\b",
    ), 15),
    ("role_confusion", re.compile(
        r"(?i)(##\s*system|\bsystem\s*:|you\s+are\s+now\b)",
    ), 15),
    ("dangerous_command", re.compile(
        r"`[^`]*\brm\s+-[rRf]+\s+/[^`]*`"
        r"|`[^`]*curl[^`]*\|\s*(sh|bash)[^`]*`",
    ), 40),
    ("unsafe_uri", re.compile(
        # javascript:... data:... file://...
        # Either form: scheme:[//]anything-up-to-whitespace-or-paren
        r"(?i)\b(javascript|data|file):/{0,2}[^\s)\]]+",
    ), 10),
    # Unicode tag block (E0000-E007F): hidden steganography for LLMs
    ("hidden_unicode", re.compile(
        r"[\U000e0000-\U000e007f]+",
    ), 20),
]


def _scan(text: str, field_name: str) -> List[FlaggedSpan]:
    """Return all matches across all patterns in `text`."""
    out: List[FlaggedSpan] = []
    for category, pattern, _weight in _PATTERNS:
        for m in pattern.finditer(text):
            out.append(FlaggedSpan(
                category=category, match_text=m.group(0),
                start=m.start(), end=m.end(), field=field_name,
            ))
    return out


def _redact(text: str, spans: List[FlaggedSpan]) -> str:
    """Replace each span in `text` with `[REDACTED:<category>]`. Right-to-left
    so character offsets stay valid."""
    if not spans:
        return text
    out = text
    for sp in sorted(spans, key=lambda s: -s.start):
        out = out[:sp.start] + f"[REDACTED:{sp.category}]" + out[sp.end:]
    return out


def sanitize_issue(title: str, body: str) -> SanitizationResult:
    """Scan title+body, redact injections, return SanitizationResult."""
    title_spans = _scan(title or "", "title")
    body_spans = _scan(body or "", "body")
    all_spans = title_spans + body_spans
    # Weighted risk score (clamped 0..100)
    weight_map = {cat: w for cat, _, w in _PATTERNS}
    raw = sum(weight_map.get(s.category, 5) for s in all_spans)
    risk = max(0, min(100, raw))
    clean_title = _redact(title or "", title_spans)
    clean_body = _redact(body or "", body_spans)
    return SanitizationResult(
        clean_title=clean_title,
        clean_body=clean_body,
        flagged_spans=all_spans,
        risk_score=risk,
    )
