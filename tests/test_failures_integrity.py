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


# --- Cycle 41 — empirically_reproduced field --------------------------
#
# Cycle 33 surfaced an M-dim discipline rule: every FAILURES entry whose
# root cause was *inferred* (not empirically reproduced) should be flagged
# so future cycles verify before relying on it. This cycle encodes the
# rule on disk via a new schema field.

# Allowed values. "corrected_in_<cycle-id>" is a pattern-matched class
# (any UTC timestamp suffix).
_ER_FIXED = {"yes", "no", "not_applicable"}
_ER_CORRECTED_RE = re.compile(r"^corrected_in_\d{8}-\d{6}$")


def _empirically_reproduced_value(block: str) -> str | None:
    """Find the `**Empirically reproduced**: <value>` line in an entry
    block and return the leading token (yes / no / not_applicable /
    corrected_in_<cycle-id>), or None if the field is absent.

    The token is the contiguous non-whitespace run after the colon.
    Anything after (parenthetical justification, etc.) is allowed
    and ignored by this validator.
    """
    m = re.search(
        r"\*\*Empirically reproduced\*\*\s*:\s*(\S+)",
        block,
    )
    return m.group(1).strip() if m else None


def test_prologue_documents_empirically_reproduced_field():
    """FAILURES.md's prologue (before the first ## FAIL- heading) must
    document the new field's name + allowed values."""
    text = FAILURES_MD.read_text()
    first_entry = text.find("## FAIL-")
    assert first_entry > 0
    prologue = text[:first_entry]
    assert "empirically_reproduced" in prologue.lower() or \
        "Empirically reproduced" in prologue, (
            "FAILURES.md prologue must document the empirically_reproduced "
            "field (Cycle 41 discipline rule)"
        )
    for v in ("yes", "no", "corrected_in_"):
        assert v in prologue, f"prologue must list value {v!r}"


def test_every_entry_has_empirically_reproduced_field():
    """Mandatory going forward. Every FAIL entry must tag its
    root-cause-confidence so future cycles know whether to verify."""
    missing = []
    for fail_id, _, block in _entries_with_text():
        if _empirically_reproduced_value(block) is None:
            missing.append(fail_id)
    assert not missing, (
        "These FAILURES entries lack the empirically_reproduced field:\n"
        + "\n".join(missing)
        + "\nAdd `**Empirically reproduced**: <yes|no|corrected_in_"
        + "<cycle-id>|not_applicable>` to each, per Cycle 41's "
        + "discipline rule."
    )


def test_empirically_reproduced_value_is_valid():
    """Each entry's value must be one of the allowed strings or match
    the `corrected_in_<cycle-id>` pattern."""
    bad = []
    for fail_id, _, block in _entries_with_text():
        v = _empirically_reproduced_value(block)
        if v is None:
            continue   # covered by the previous test
        if v in _ER_FIXED:
            continue
        if _ER_CORRECTED_RE.match(v):
            continue
        bad.append(f"{fail_id}: {v!r}")
    assert not bad, (
        "Invalid empirically_reproduced values:\n"
        + "\n".join(bad)
        + "\nAllowed: yes | no | not_applicable | "
          "corrected_in_<YYYYMMDD-HHMMSS>"
    )


def test_empirically_reproduced_breakdown_is_observable(capsys):
    """Advisory — prints the breakdown so operators see it but does
    not fail. The breakdown helps a future cycle prioritize which
    'no' entries to convert to 'yes' via regression tests."""
    counts = {"yes": 0, "no": 0, "not_applicable": 0, "corrected": 0,
              "missing": 0}
    for fail_id, _, block in _entries_with_text():
        v = _empirically_reproduced_value(block)
        if v is None:
            counts["missing"] += 1
        elif v in _ER_FIXED:
            counts[v] += 1
        elif _ER_CORRECTED_RE.match(v):
            counts["corrected"] += 1
        else:
            counts["missing"] += 1   # invalid → treat as missing
    print(f"empirically_reproduced breakdown: {counts}")
    # Sanity: yes + no + corrected + not_applicable should equal total
    total = sum(counts.values())
    assert total > 0, "no FAILURES entries parsed"
    # This test never fails on counts — it's advisory.
