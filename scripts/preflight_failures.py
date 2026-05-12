#!/usr/bin/env python3
"""preflight_failures.py — Track M2 (L7).

Greps `FAILURES.md` for keyword overlap with a proposed PLAN.md. If the
planner is about to do something a previous cycle already failed at, the
planner must either cite the FAIL-NNNN id and explain why this time is
different, OR pick a different approach.

Per §5 of `AUTODEV_L7_MASTER_PROMPT.md`:
  Before every PLAN you must grep FAILURES.md for keywords matching your
  approach. If hit, cite why this time is different OR pick another
  approach. This single rule prevents repeat-failure spirals.

Usage:
    scripts/preflight_failures.py --plan PATH [--failures PATH]
                                  [--json] [--strict]

Exit codes:
    0 — no matches (or --strict + all matches cited in PLAN)
    1 — matches found and not all cited (--strict) or default soft-warn
    2 — usage error (missing PLAN, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional


# Stopwords intentionally minimal — we don't want to over-filter and miss
# matches. The grep is for "did we already fail at something like this",
# which deliberately errs on the side of false positives that the planner
# can dismiss with a citation.
_STOPWORDS = frozenset({
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "by",
    "for", "is", "are", "was", "were", "be", "been", "being",
    "this", "that", "these", "those",
    "it", "its", "with", "as", "if", "then", "else", "so",
    "we", "our", "us", "you", "your", "they", "them",
    "do", "does", "did", "done", "will", "would", "should", "must", "may",
    "can", "could",
    "from", "into", "out", "up", "down", "over", "under",
    "all", "any", "some", "no", "not", "new", "old",
    "what", "when", "where", "which", "how", "why",
    # Generic planning words that shouldn't trigger matches
    "change", "made", "being", "files", "touch", "plan", "target", "dim",
    "open", "questions", "risk", "score", "low", "medium", "high",
    "criteria", "acceptance", "rollback",
})


# Section headers in the PLAN.md we extract keywords FROM. Note we do NOT
# include "FAILURES.md pre-flight result" — that's the OUTPUT slot this
# script writes into, so grepping it would re-match the tool's own name and
# create spurious self-reference hits.
_RELEVANT_SECTIONS = (
    "Change being made",
    "Files to touch",
    "Specific gap being closed",
)


@dataclass
class FailureEntry:
    id: str                         # e.g. "FAIL-0042"
    headline: str = ""              # the ## heading after the id
    keywords: List[str] = field(default_factory=list)


@dataclass
class Match:
    entry: FailureEntry
    matching_keywords: List[str]
    score: int                       # number of overlapping keywords


# --- Keyword extraction ----------------------------------------------------


def _normalise_token(tok: str) -> str:
    """Lowercase, strip surrounding punctuation, and collapse `-` to `_`
    so 'tdd-intent' and 'tdd_intent' compare equal at match time."""
    s = tok.strip().strip(".,;:()[]{}\"'`").lower()
    return s.replace("-", "_")


_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_./-]{1,40}")


def extract_keywords(plan_text: str) -> List[str]:
    """Pull candidate keywords from the PLAN's relevant sections.

    Strategy:
    - Find each `## <Section>` header that matches one of `_RELEVANT_SECTIONS`
    - Take the text between that header and the next `##`
    - Tokenize on word boundaries, normalize, drop stopwords + 2-char tokens
    - Deduplicate, preserving first-seen order
    """
    if not plan_text:
        return []
    keywords: List[str] = []
    seen = set()

    # Find all ## headings + their positions
    headings = list(re.finditer(r"^##\s+(.+)$", plan_text, flags=re.MULTILINE))
    for i, m in enumerate(headings):
        title = m.group(1).strip()
        if not any(s.lower() in title.lower() for s in _RELEVANT_SECTIONS):
            continue
        start = m.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(plan_text)
        section_text = plan_text[start:end]
        for tok_match in _TOKEN_RE.finditer(section_text):
            t = _normalise_token(tok_match.group(0))
            if not t or len(t) < 3:
                continue
            if t in _STOPWORDS:
                continue
            # Drop very-common Markdown / Python noise that survived above
            if t in {"py", "md", "yaml", "json", "true", "false", "none"}:
                continue
            if t not in seen:
                seen.add(t)
                keywords.append(t)
    return keywords


# --- FAILURES.md parsing ---------------------------------------------------


_FAIL_HEADING_RE = re.compile(r"^##\s+(FAIL-\d+):\s*(.*)$", re.MULTILINE)
_FAIL_KEYWORDS_RE = re.compile(
    r"^\*\*Keywords\*\*\s*:\s*(.+?)(?=^##|\Z)",
    re.MULTILINE | re.DOTALL,
)


def parse_failures(path: Path) -> List[FailureEntry]:
    """Read FAILURES.md and return one FailureEntry per `## FAIL-NNNN` block.

    Each entry's `.keywords` is the comma-separated list under the
    `**Keywords**: ` line in that block.
    """
    if not path.exists():
        return []
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return []

    entries: List[FailureEntry] = []
    headings = list(_FAIL_HEADING_RE.finditer(text))
    for i, h in enumerate(headings):
        fail_id = h.group(1)
        headline = h.group(2).strip()
        start = h.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        block = text[start:end]
        kws: List[str] = []
        kw_match = re.search(r"\*\*Keywords\*\*\s*:\s*(.+?)(?=\n\n|\Z|\n---)",
                             block, flags=re.DOTALL)
        if kw_match:
            raw = kw_match.group(1)
            # Split on commas / newlines; normalize
            for piece in re.split(r"[,\n]+", raw):
                t = _normalise_token(piece)
                if t and len(t) >= 3 and t not in _STOPWORDS:
                    kws.append(t)
        entries.append(FailureEntry(id=fail_id, headline=headline, keywords=kws))
    return entries


# --- Matching --------------------------------------------------------------


def match_keywords(keywords: List[str],
                   entries: List[FailureEntry]) -> List[Match]:
    """For each entry, count how many of `keywords` appear in its keyword
    list (after the same normalisation). Return Match list sorted by score
    descending, then by entry id ascending. Entries with 0 overlap are
    excluded."""
    if not keywords or not entries:
        return []
    kw_set = {_normalise_token(k) for k in keywords if k}
    matches: List[Match] = []
    for e in entries:
        entry_kw_set = {_normalise_token(k) for k in e.keywords if k}
        overlap = sorted(kw_set & entry_kw_set)
        if overlap:
            matches.append(Match(entry=e, matching_keywords=overlap,
                                 score=len(overlap)))
    matches.sort(key=lambda m: (-m.score, m.entry.id))
    return matches


# --- CLI -------------------------------------------------------------------


def _all_matches_cited(plan_text: str, matches: List[Match]) -> bool:
    """In --strict mode, a planner can pass IF every matched FAIL-NNNN id
    appears literally somewhere in the PLAN.md (typically in
    'FAILURES.md pre-flight result' citing why this time is different)."""
    for m in matches:
        if m.entry.id not in plan_text:
            return False
    return True


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Grep FAILURES.md for keyword overlap with a PLAN.md"
    )
    parser.add_argument("--plan", required=True,
                        help="path to the cycle's PLAN.md")
    parser.add_argument("--failures", default="FAILURES.md",
                        help="path to FAILURES.md (default: ./FAILURES.md)")
    parser.add_argument("--json", action="store_true",
                        help="emit machine-readable JSON to stdout")
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 only if matches are NOT all cited "
                             "by FAIL-NNNN id in the PLAN.md")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="explain matches in human-readable form")
    args = parser.parse_args(argv)

    plan_path = Path(args.plan)
    if not plan_path.exists():
        print(f"[preflight_failures] PLAN.md not found: {plan_path}",
              file=sys.stderr)
        return 2

    plan_text = plan_path.read_text(errors="replace")
    keywords = extract_keywords(plan_text)
    failures_path = Path(args.failures)
    entries = parse_failures(failures_path)
    matches = match_keywords(keywords, entries)

    if args.json:
        payload = {
            "plan": str(plan_path),
            "failures": str(failures_path),
            "keywords": keywords,
            "matches": [
                {
                    "id": m.entry.id,
                    "headline": m.entry.headline,
                    "matching_keywords": m.matching_keywords,
                    "score": m.score,
                }
                for m in matches
            ],
            "strict": args.strict,
            "all_cited": _all_matches_cited(plan_text, matches),
            "summary": (
                f"{len(matches)} match(es) across {len(entries)} entries"
            ),
        }
        print(json.dumps(payload, indent=2))
        if args.strict:
            return 0 if payload["all_cited"] else 1
        return 1 if matches else 0

    # Human-readable mode
    if not matches:
        if args.verbose:
            print(f"[preflight_failures] OK — {len(keywords)} keyword(s) "
                  f"checked against {len(entries)} entries, 0 matches")
        return 0

    print(f"[preflight_failures] {len(matches)} match(es) — "
          "FAILURES.md flagged potential repeat:")
    for m in matches:
        cited = "✓ cited" if m.entry.id in plan_text else "✗ NOT cited"
        print(f"  - {m.entry.id} [{cited}] score={m.score} "
              f"overlap={m.matching_keywords}")
        if args.verbose:
            print(f"      {m.entry.headline}")

    if args.strict:
        if _all_matches_cited(plan_text, matches):
            return 0
        print("[preflight_failures] --strict: PLAN must cite each FAIL-NNNN id "
              "with why this time is different. Refusing.", file=sys.stderr)
        return 1
    # Default: soft warn (exit 1) but don't block
    return 1


if __name__ == "__main__":
    sys.exit(main())
