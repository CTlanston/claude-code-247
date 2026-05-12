#!/usr/bin/env python3
"""propose_next_track.py — L7 §6 Track E2.

Reads LEVEL.md + BACKLOG.md + FAILURES.md and proposes the next track
the operator (or a future autonomous loop) should pick up. Outputs JSON
listing the chosen track, ranked alternatives, and reasoning.

This script is read-only — it does not mutate any L7 memory file. To
*apply* the proposal, a subsequent cycle's PLAN must explicitly choose
the track (or override with a justified alternative).

Usage:
    scripts/propose_next_track.py [--repo-root PATH] [--json]
                                  [--for-cycle CYCLE_ID]
                                  [--verbose]

Output:
    - stdout (default human-readable)
    - stdout (machine-readable JSON via --json)
    - cycles/<CYCLE_ID>/next-track-proposal.json (via --for-cycle)

Exit codes:
    0 — proposal emitted successfully
    1 — no eligible tracks in BACKLOG
    2 — usage / file-not-found error
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional, Dict


DIMS = ("M", "S", "R", "C", "T", "E")
PRIORITY_RANK = {"P0": 4, "P1": 3, "P2": 2, "P3": 1}


# Match a BACKLOG.md item line:
#   - [ ] [Track XXX] title (priority: PN)
#   - [x] [Track XXX] title DONE in <cycle_id>
#   - ~~[Track XXX] ...~~ DROPPED: reason
_OPEN_RE = re.compile(
    r"^\s*-\s*\[\s\]\s*\[(Track\s+[^\]]+)\]\s+(.+?)\s*(?:\(priority:\s*(P\d)\))?\s*$",
    re.MULTILINE,
)
_DONE_RE = re.compile(
    r"^\s*-\s*\[x\]\s*\[(Track\s+[^\]]+)\]\s+(.+?)$",
    re.MULTILINE,
)
_DROPPED_RE = re.compile(
    r"^\s*-\s*~~\[(Track\s+[^\]]+)\]\s+(.+?)~~",
    re.MULTILINE,
)

# Match "rubric dim: X" line within an item's follow-up text. Captures the
# dim letter; tolerates either single letter (M/S/R/C/T/E) or a parenthetical
# label like "S (Safety)".
_DIM_LINE_RE = re.compile(
    r"rubric\s+dim\s*:\s*([MSRCTE])(?:\s|$|\(|—|-)",
    re.IGNORECASE,
)
_PRIORITY_LINE_RE = re.compile(r"priority\s*:\s*(P\d)", re.IGNORECASE)


@dataclass
class BacklogItem:
    track_id: str                       # e.g. "Track E2"
    title: str
    priority: str = "P2"                 # default if not stated
    dim: Optional[str] = None            # one of DIMS or None
    status: str = "open"                 # open | done | dropped
    details: str = ""                    # raw follow-up text


@dataclass
class FailureLite:
    id: str
    keywords: List[str]
    fixed: bool                          # False if "Working fix" says NOT YET


@dataclass
class ScoredItem:
    item: BacklogItem
    score: float
    components: Dict[str, float] = field(default_factory=dict)


@dataclass
class Proposal:
    chosen: Optional[BacklogItem]
    alternatives: List[ScoredItem]
    levels: Dict[str, int]
    failure_citations: List[str]
    reasoning: str
    considered_failures: List[Dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "chosen": asdict(self.chosen) if self.chosen else None,
            "alternatives": [
                {
                    "track_id": s.item.track_id,
                    "priority": s.item.priority,
                    "dim": s.item.dim,
                    "score": s.score,
                    "components": s.components,
                }
                for s in self.alternatives
            ],
            "levels": self.levels,
            "failure_citations": self.failure_citations,
            "considered_failures": self.considered_failures,
            "reasoning": self.reasoning,
        }


# --- Parsing ---------------------------------------------------------------


def parse_level_md_text(text: str) -> Dict[str, int]:
    """Parse LEVEL.md content into {dim: level}."""
    parsed: Dict[str, int] = {}
    for line in text.splitlines():
        m = re.match(r"^([MSRCTE])\s+(\d+)\s*\|", line)
        if m:
            parsed[m.group(1)] = int(m.group(2))
    return parsed


def _parse_backlog_block(track_id: str, status: str, line_text: str,
                          follow_up: str,
                          captured_priority: Optional[str] = None) -> BacklogItem:
    # Priority precedence: (a) captured from the title line's `(priority: PN)`
    # suffix; (b) explicit "priority: PN" mention in follow-up text;
    # (c) default to "P2".
    if captured_priority:
        priority = captured_priority.upper()
    else:
        pmatch = _PRIORITY_LINE_RE.search(line_text) \
            or _PRIORITY_LINE_RE.search(follow_up)
        priority = pmatch.group(1).upper() if pmatch else "P2"
    dmatch = _DIM_LINE_RE.search(follow_up)
    dim = dmatch.group(1).upper() if dmatch else None
    return BacklogItem(track_id=track_id.strip(), title=line_text.strip(),
                       priority=priority, dim=dim, status=status,
                       details=follow_up.strip())


def parse_backlog_text(text: str) -> List[BacklogItem]:
    """Parse BACKLOG.md content. Each `- [ ] [Track X]` line plus its
    indented follow-up becomes a BacklogItem."""
    items: List[BacklogItem] = []
    # Walk line-by-line to capture indented follow-up text after each item
    lines = text.splitlines(keepends=False)
    i = 0
    while i < len(lines):
        line = lines[i]
        open_m = _OPEN_RE.match(line)
        done_m = _DONE_RE.match(line)
        dropped_m = _DROPPED_RE.match(line)
        if open_m or done_m or dropped_m:
            m = open_m or done_m or dropped_m
            track_id = m.group(1)
            title = m.group(2)
            status = "open" if open_m else "done" if done_m else "dropped"
            # Only _OPEN_RE captures priority in group 3
            captured_pri = open_m.group(3) if open_m and open_m.lastindex and open_m.lastindex >= 3 else None
            # Collect indented follow-up lines until the next non-indented
            # line or the next "- " bullet.
            follow_up_lines: List[str] = []
            j = i + 1
            while j < len(lines):
                ln = lines[j]
                if not ln.strip():
                    j += 1
                    continue
                if ln.startswith("- ") or ln.startswith("#") or ln.startswith("##"):
                    break
                if ln.startswith("  ") or ln.startswith("\t"):
                    follow_up_lines.append(ln)
                    j += 1
                    continue
                break
            items.append(_parse_backlog_block(track_id, status, title,
                                              "\n".join(follow_up_lines),
                                              captured_priority=captured_pri))
            i = j
        else:
            i += 1
    return items


def parse_failures_text(text: str) -> List[FailureLite]:
    """Lightweight FAILURES.md parse for proposal scoring."""
    entries: List[FailureLite] = []
    headings = list(re.finditer(r"^##\s+(FAIL-\d+):\s*(.*)$", text,
                                 flags=re.MULTILINE))
    for i, h in enumerate(headings):
        fail_id = h.group(1)
        start = h.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        block = text[start:end]
        kws: List[str] = []
        kw_match = re.search(r"\*\*Keywords\*\*\s*:\s*(.+?)(?=\n\n|\Z|\n---)",
                              block, flags=re.DOTALL)
        if kw_match:
            for piece in re.split(r"[,\n]+", kw_match.group(1)):
                p = piece.strip().strip(".,;:()[]{}\"'`").lower().replace("-", "_")
                if p and len(p) >= 3:
                    kws.append(p)
        # Heuristic: "NOT YET" anywhere in the block → unfixed
        fix_match = re.search(r"\*\*Working fix\*\*\s*:\s*(.+?)(?=\*\*|\Z|\n##)",
                              block, flags=re.DOTALL)
        fixed = True
        if fix_match:
            txt = fix_match.group(1).lower()
            if "not yet" in txt or "planned" in txt:
                fixed = False
        entries.append(FailureLite(id=fail_id, keywords=kws, fixed=fixed))
    return entries


# --- Scoring ---------------------------------------------------------------


def _track_keywords(item: BacklogItem) -> List[str]:
    """Tokenize a BacklogItem's id+title+details for failure-overlap check."""
    full = f"{item.track_id} {item.title} {item.details}".lower()
    tokens: List[str] = []
    for tok in re.findall(r"[a-z][a-z0-9_./-]{2,40}", full):
        tokens.append(tok.replace("-", "_"))
    return tokens


def _unfixed_overlap(item: BacklogItem,
                     failures: List[FailureLite]) -> List[str]:
    """Return the list of FAIL ids whose UNFIXED keywords overlap with the
    item's keywords (penalty signal)."""
    item_kws = set(_track_keywords(item))
    citations: List[str] = []
    for f in failures:
        if f.fixed:
            continue
        fkws = set(f.keywords)
        if item_kws & fkws:
            citations.append(f.id)
    return citations


def score_item(item: BacklogItem, levels: Dict[str, int],
               failures: List[FailureLite]) -> ScoredItem:
    components: Dict[str, float] = {}
    # Priority weight
    components["priority"] = float(PRIORITY_RANK.get(item.priority, 1))
    # Floor preference: lower current level = higher score
    if item.dim and item.dim in levels:
        components["floor_pref"] = max(0.0, 7.0 - levels[item.dim])
    else:
        components["floor_pref"] = 1.0  # cross-cuts / aux: small constant
    # Unfixed-failure overlap penalty
    overlaps = _unfixed_overlap(item, failures)
    components["failure_penalty"] = -2.0 * len(overlaps)
    # Done / dropped: zero them out (caller should filter)
    if item.status != "open":
        for k in list(components):
            components[k] = 0.0
    total = sum(components.values())
    return ScoredItem(item=item, score=total, components=components)


def propose(levels: Dict[str, int],
            backlog: List[BacklogItem],
            failures: List[FailureLite]) -> Proposal:
    eligible = [b for b in backlog if b.status == "open"]
    if not eligible:
        return Proposal(
            chosen=None, alternatives=[], levels=levels,
            failure_citations=[],
            reasoning="No open items in BACKLOG.md.",
            considered_failures=_considered_failures_for(
                None, failures, top_n=3),
        )
    scored = [score_item(b, levels, failures) for b in eligible]
    scored.sort(key=lambda s: (-s.score, s.item.priority,
                                s.item.dim or "Z", s.item.track_id))
    chosen = scored[0].item
    citations = sorted({c for s in scored[:5]
                          for c in _unfixed_overlap(s.item, failures)})
    considered = _considered_failures_for(chosen, failures, top_n=3)
    reasoning_parts = [
        f"Chose {chosen.track_id} (priority={chosen.priority}, "
        f"dim={chosen.dim}, score={scored[0].score:.2f}).",
    ]
    if chosen.dim and chosen.dim in levels:
        reasoning_parts.append(
            f"{chosen.dim}-dim is currently L{levels[chosen.dim]}; "
            f"this track aims to lift it."
        )
    if scored[0].components.get("failure_penalty", 0) < 0:
        reasoning_parts.append(
            "NOTE: this track has overlap with unfixed FAILURES — "
            "plan must cite them."
        )
    # Always reference what was considered, even if no high-overlap match
    if considered:
        top_ids = ", ".join(c["id"] for c in considered[:3])
        reasoning_parts.append(
            f"FAILURES consulted: {top_ids}."
        )
    return Proposal(chosen=chosen, alternatives=scored[1:4],
                    levels=levels, failure_citations=citations,
                    reasoning=" ".join(reasoning_parts),
                    considered_failures=considered)


def _considered_failures_for(item: Optional[BacklogItem],
                              failures: List[FailureLite],
                              top_n: int = 3) -> List[Dict]:
    """Return the top-N FAILURES entries by Jaccard overlap with the
    track's keywords, plus any unfixed overlaps regardless of rank.
    Each entry is a JSON-safe dict with id, overlap_keywords, score,
    fixed. Always non-empty when `failures` is non-empty."""
    if not failures:
        return []
    if item is None:
        # Fallback: list the first few failures so the proposal mentions them
        return [
            {"id": f.id, "overlap_keywords": [], "score": 0.0,
             "fixed": f.fixed, "reason": "no chosen track"}
            for f in failures[:top_n]
        ]
    item_kws = set(_track_keywords(item))
    scored: List[tuple] = []
    for f in failures:
        fkws = set(f.keywords)
        if not fkws and not item_kws:
            j = 0.0
        elif not (fkws | item_kws):
            j = 0.0
        else:
            j = len(item_kws & fkws) / max(1, len(item_kws | fkws))
        scored.append((j, f))
    scored.sort(key=lambda t: -t[0])
    out: List[Dict] = []
    seen: set = set()
    for j, f in scored[:top_n]:
        out.append({
            "id": f.id,
            "overlap_keywords": sorted(item_kws & set(f.keywords)),
            "score": round(j, 4),
            "fixed": f.fixed,
        })
        seen.add(f.id)
    # Always include any unfixed overlap (operator must see these)
    for j, f in scored:
        if not f.fixed and (item_kws & set(f.keywords)) and f.id not in seen:
            out.append({
                "id": f.id,
                "overlap_keywords": sorted(item_kws & set(f.keywords)),
                "score": round(j, 4),
                "fixed": f.fixed,
                "unfixed_overlap": True,
            })
            seen.add(f.id)
    return out


def propose_from_repo(repo_root: Path) -> Proposal:
    repo_root = Path(repo_root)
    level_text = (repo_root / "LEVEL.md").read_text() if (repo_root / "LEVEL.md").exists() else ""
    backlog_text = (repo_root / "BACKLOG.md").read_text() if (repo_root / "BACKLOG.md").exists() else ""
    failures_text = (repo_root / "FAILURES.md").read_text() if (repo_root / "FAILURES.md").exists() else ""
    return propose(
        parse_level_md_text(level_text),
        parse_backlog_text(backlog_text),
        parse_failures_text(failures_text),
    )


# --- CLI -------------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Propose the next L7 track based on LEVEL + BACKLOG + FAILURES"
    )
    parser.add_argument("--repo-root",
                        default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--json", action="store_true",
                        help="emit machine-readable JSON to stdout")
    parser.add_argument("--for-cycle", default=None,
                        help="write to cycles/<CYCLE_ID>/next-track-proposal.json")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root)
    if not repo_root.exists():
        print(f"[propose_next_track] repo not found: {repo_root}", file=sys.stderr)
        return 2

    proposal = propose_from_repo(repo_root)

    if args.for_cycle:
        out_dir = repo_root / "cycles" / args.for_cycle
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / "next-track-proposal.json"
        out_file.write_text(json.dumps(proposal.to_dict(), indent=2))
        if not args.json:
            print(f"[propose_next_track] wrote {out_file}")

    if args.json:
        print(json.dumps(proposal.to_dict(), indent=2))
    else:
        if proposal.chosen is None:
            print("[propose_next_track] no eligible tracks; BACKLOG.md empty?")
            return 1
        print(f"chosen: {proposal.chosen.track_id} "
              f"({proposal.chosen.priority}, dim={proposal.chosen.dim})")
        print(f"reasoning: {proposal.reasoning}")
        if args.verbose:
            for alt in proposal.alternatives:
                print(f"  alt: {alt.item.track_id} score={alt.score:.2f}")
    return 0 if proposal.chosen else 1


if __name__ == "__main__":
    sys.exit(main())
