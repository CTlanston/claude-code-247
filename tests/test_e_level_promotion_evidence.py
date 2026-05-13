"""Regression tests for E-L7 promotion-evidence chain (Track E7).

The L7 rubric E-L7 acceptance requires `compute_level.py` to find at
least 3 🎯-marked CHANGELOG entries whose cycle folders have a REPORT.md
mentioning "next-track-proposal".

These tests are the operator-facing guarantee that the chain stays
intact across future cycles. Any deletion of a cited REPORT, rename of
a cycle folder, or removal of the 🎯 marker will trip these.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
CYCLES_DIR = REPO_ROOT / "cycles"
CHANGELOG = REPO_ROOT / "CHANGELOG.md"


_CYCLE_ID_RE = re.compile(r"(\d{8}-\d{6})")


def _changelog_promotions():
    """Yield (cycle_id, line) for every 🎯-marked CHANGELOG line that
    starts with a parseable cycle id."""
    if not CHANGELOG.exists():
        return
    for line in CHANGELOG.read_text().splitlines():
        if "🎯" not in line:
            continue
        m = _CYCLE_ID_RE.match(line.strip())
        if not m:
            continue
        yield m.group(1), line


def test_changelog_has_at_least_3_promotions():
    """E-L7 requires ≥ 3 promotions in the CHANGELOG."""
    promotions = list(_changelog_promotions())
    assert len(promotions) >= 3, (
        f"Only {len(promotions)} 🎯 entries in CHANGELOG.md; "
        f"E-L7 needs ≥ 3 to fire. Promotions found: "
        f"{[p[0] for p in promotions]}"
    )


def test_each_promotion_cycle_folder_exists():
    """Each cited cycle id must have a real cycles/<id>/ folder."""
    missing = []
    for cycle_id, _line in _changelog_promotions():
        folder = CYCLES_DIR / cycle_id
        if not folder.exists():
            missing.append(cycle_id)
    assert not missing, (
        f"Promotion cycle folders missing: {missing}. CHANGELOG cites "
        "promotions for cycles that don't exist on disk."
    )


def test_each_promotion_report_cites_next_track_proposal():
    """Each cited cycle's REPORT.md must mention 'next-track-proposal'
    so the L7 evidence chain stays intact."""
    failing = []
    for cycle_id, _line in _changelog_promotions():
        report = CYCLES_DIR / cycle_id / "REPORT.md"
        if not report.exists():
            failing.append(f"{cycle_id}: no REPORT.md")
            continue
        text = report.read_text()
        if "next-track-proposal" not in text:
            failing.append(f"{cycle_id}: REPORT.md missing next-track-proposal cite")
    assert not failing, (
        "Promotion REPORT.md files missing the proposal-citation that "
        f"E-L7 evidence requires:\n  " + "\n  ".join(failing)
    )


def test_each_promotion_has_proposal_artifact():
    """Each cited cycle should ALSO have a next-track-proposal.json
    artifact (the actual proposal output, not just a citation in prose).
    Bootstrap is exempt — propose_next_track didn't exist yet.

    This is the strongest evidence layer: a JSON artifact proves the
    proposal mechanism was invoked for that cycle."""
    BOOTSTRAP = "20260512-042701"
    missing = []
    for cycle_id, _line in _changelog_promotions():
        if cycle_id == BOOTSTRAP:
            continue
        artifact = CYCLES_DIR / cycle_id / "next-track-proposal.json"
        if not artifact.exists():
            missing.append(cycle_id)
    assert not missing, (
        f"Cycles missing next-track-proposal.json artifact: {missing}"
    )
