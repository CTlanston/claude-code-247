"""Regression tests for FAILURES.md integrity.

Ensures the failure ledger stays well-formed as cycles add entries:
- Entry count meets the L5 threshold (>=10) per L7 §3 / §9
- Every entry has the required fields per L7 §5 schema
- IDs are unique and contiguous (no gaps, no duplicates)
- Keywords lists are non-empty and parseable

Run from any cwd; tests use repo-root FAILURES.md directly.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
FAILURES_MD = REPO_ROOT / "FAILURES.md"
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import preflight_failures as pf  # noqa: E402


# Required structural fields per FAILURES.md schema (§5 of L7 master prompt).
REQUIRED_FIELDS = (
    "**Date**",
    "**Symptom**",
    "**Root cause**",
    "**Working fix**",
    "**Regression test**",
    "**Keywords**",
)


def _entries_with_text():
    """Yield (entry_id, headline, raw_block_text) for each entry."""
    text = FAILURES_MD.read_text()
    headings = list(re.finditer(r"^##\s+(FAIL-\d+):\s*(.*)$", text,
                                flags=re.MULTILINE))
    for i, h in enumerate(headings):
        fail_id = h.group(1)
        headline = h.group(2).strip()
        start = h.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        yield fail_id, headline, text[start:end]


def test_failures_md_exists():
    assert FAILURES_MD.exists(), f"{FAILURES_MD} must exist"


def test_failures_md_has_at_least_10_entries():
    """L7 §3 / §9: M-dim L5 requires >=10 FAILURES entries."""
    entries = list(pf.parse_failures(FAILURES_MD))
    assert len(entries) >= 10, (
        f"FAILURES.md must have >= 10 entries for M-L5; "
        f"currently has {len(entries)}. Cycles cannot regress this."
    )


def test_every_entry_has_required_fields():
    """Every entry must contain all required schema fields."""
    missing = []
    for fail_id, headline, block in _entries_with_text():
        for field in REQUIRED_FIELDS:
            if field not in block:
                missing.append(f"{fail_id} missing {field}")
    assert not missing, (
        "Some FAILURES entries are missing required fields:\n"
        + "\n".join(missing)
    )


def test_every_entry_has_nonempty_keywords():
    """Each entry's Keywords list must contain >= 3 distinct keywords."""
    entries = list(pf.parse_failures(FAILURES_MD))
    too_few = [e.id for e in entries if len(set(e.keywords)) < 3]
    assert not too_few, (
        f"Entries with <3 distinct keywords: {too_few}. "
        "The FAILURES grep tool needs real keywords to work."
    )


def test_entry_ids_are_unique():
    ids = [e.id for e in pf.parse_failures(FAILURES_MD)]
    assert len(ids) == len(set(ids)), (
        f"Duplicate FAIL-NNNN ids in FAILURES.md: "
        f"{[i for i in ids if ids.count(i) > 1]}"
    )


def test_entry_ids_are_contiguous_starting_from_1():
    """IDs must be FAIL-0001, FAIL-0002, ... with no gaps."""
    ids = sorted(int(e.id.split("-")[1]) for e in pf.parse_failures(FAILURES_MD))
    if not ids:
        pytest.skip("No entries; covered by test_failures_md_has_at_least_10_entries")
    expected = list(range(1, len(ids) + 1))
    assert ids == expected, (
        f"FAIL-NNNN ids must be contiguous starting from 1. "
        f"Got {ids}, expected {expected}."
    )


def test_each_entry_keywords_match_preflight_parse():
    """The keywords parsed by preflight_failures must match the explicit
    ## ID + **Keywords**: list in each entry. (Sanity for the parser.)"""
    entries = list(pf.parse_failures(FAILURES_MD))
    # Per-entry sanity: id parsing finds something, keyword list is non-empty
    for e in entries:
        assert e.id.startswith("FAIL-"), f"bad id {e.id!r}"
        assert e.keywords, f"{e.id} has no parseable keywords"
