"""Structural tests for ADR-0009 (Cycle 43).

ADR-0009 documents the "runtime emission must not dirty the
tracked tree" discipline that emerged across Cycles 33/38/39/40.
These tests pin the ADR's required sections + content so a
future edit can't silently drop the canonical pattern.
"""
from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
ADR = REPO_ROOT / "docs" / "adr" / "0009-runtime-emission-no-tree-dirty.md"


def _text() -> str:
    return ADR.read_text(encoding="utf-8")


def test_adr_0009_exists():
    assert ADR.exists(), (
        f"{ADR} must exist (Cycle 43 adds the canonical doc for the "
        f"runtime-emission-not-tracked-tree-dirty discipline)"
    )


def test_adr_0009_has_required_sections():
    """Standard ADR template sections."""
    txt = _text()
    for section in ("Context", "Decision", "Consequences"):
        assert f"## {section}" in txt, (
            f"ADR-0009 missing required section: ## {section}"
        )


def test_adr_0009_references_all_four_applying_cycles():
    """The 4 cycles that applied the pattern in 2026-05-13:
    33 (env-var gate), 38 (read-only consumer), 39 (gitignore +
    git rm --cached), 40 (combination)."""
    txt = _text()
    for cycle_num in ("33", "38", "39", "40"):
        assert f"Cycle {cycle_num}" in txt or f"cycle {cycle_num}" in txt.lower(), (
            f"ADR-0009 must reference Cycle {cycle_num} as one of "
            f"the applying cycles"
        )


def test_adr_0009_decision_lists_three_mechanisms():
    """The Decision section should enumerate the 3 acceptable
    fix mechanisms: gitignore, env-var gate, read-only consumer."""
    txt = _text().lower()
    assert "gitignore" in txt
    assert "env-var" in txt or "env var" in txt or "environment variable" in txt
    assert "read-only" in txt or "readonly" in txt or "read only" in txt


def test_adr_0009_nontrivial_size():
    """ADRs documenting a 4-cycle pattern should be >1KB."""
    assert len(_text()) > 1024, (
        f"ADR-0009 is too short ({len(_text())} bytes); a real ADR "
        f"covering the discipline + 4 applying cycles + decision "
        f"alternatives + consequences should be > 1 KB"
    )


def test_failures_md_links_to_adr_0009():
    """FAIL-0009 entry's Linked ADR field should point at 0009 so
    the cross-reference is navigable."""
    failures = (REPO_ROOT / "FAILURES.md").read_text(encoding="utf-8")
    # Find the FAIL-0009 entry block
    fail_idx = failures.find("## FAIL-0009:")
    assert fail_idx > 0
    # Next entry starts at "## FAIL-0010:"
    end_idx = failures.find("## FAIL-0010:", fail_idx)
    fail0009_block = failures[fail_idx:end_idx]
    assert "0009-runtime-emission" in fail0009_block or \
        "ADR-0009" in fail0009_block, (
        "FAIL-0009 entry must link to ADR-0009 via either a "
        "**Linked ADR**: line or an explicit ADR-0009 reference "
        "(makes the discipline cross-navigable)"
    )
