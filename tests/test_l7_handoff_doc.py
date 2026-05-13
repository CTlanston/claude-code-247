"""Structural tests for reports/L7-handoff-to-launchd.md (Cycle 30).

The handoff doc is the operator's primary reference once this session
ends and launchd takes over. These tests pin the 10 canonical sections
(per kickoff §C) + the correct script paths + the quick-reference
block. If a future edit drops a section or cites the wrong script,
the test fails.
"""
from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DOC = REPO_ROOT / "reports" / "L7-handoff-to-launchd.md"


def _text() -> str:
    return DOC.read_text(encoding="utf-8")


# --- Existence + size ---------------------------------------------------


def test_doc_exists():
    assert DOC.exists()


def test_doc_nontrivial_size():
    """Sanity guard against accidental truncation: > 5 KB."""
    assert len(_text()) > 5000, (
        "handoff doc must be > 5 KB; smaller suggests truncation"
    )


# --- 10 canonical sections (kickoff §C) --------------------------------


def test_section_1_what_runs_24_7():
    txt = _text()
    assert re.search(r"##\s+1\.\s+What runs 24/7", txt), "missing §1"


def test_section_2_how_to_install():
    txt = _text()
    assert re.search(r"##\s+2\.\s+How to install", txt), "missing §2"


def test_section_3_how_to_monitor():
    txt = _text()
    assert re.search(r"##\s+3\.\s+How to monitor", txt), "missing §3"


def test_section_4_how_to_pause():
    txt = _text()
    assert re.search(r"##\s+4\.\s+How to pause", txt), "missing §4"


def test_section_5_how_to_resume():
    txt = _text()
    assert re.search(r"##\s+5\.\s+How to resume", txt), "missing §5"


def test_section_6_how_to_fully_stop():
    txt = _text()
    assert re.search(r"##\s+6\.\s+How to fully stop", txt), "missing §6"


def test_section_7_inspect_failures():
    txt = _text()
    assert re.search(
        r"##\s+7\.\s+How to inspect failures", txt
    ), "missing §7"


def test_section_8_done_looks_like():
    txt = _text()
    assert re.search(
        r"##\s+8\.\s+What [\"“]done[\"”] looks like", txt
    ), "missing §8"


def test_section_9_cost_monitoring():
    txt = _text()
    assert re.search(r"##\s+9\.\s+Cost monitoring", txt), "missing §9"


def test_section_10_come_back_manually():
    txt = _text()
    assert re.search(
        r"##\s+10\.\s+When to come back manually", txt
    ), "missing §10"


# --- Script path citations ---------------------------------------------


def test_cites_l7_installer_path():
    """The handoff doc MUST cite the L7 installer (not the v3 one)."""
    txt = _text()
    assert "scripts/install_launchd_continuous.sh" in txt, (
        "handoff must cite the L7 installer "
        "(scripts/install_launchd_continuous.sh, not the v3 "
        "install_launchd_autodev.sh)"
    )


def test_cites_wake_script():
    txt = _text()
    assert "scripts/autodev_continuous_cycle.sh" in txt, (
        "handoff must cite the wake script"
    )


def test_cites_dashboard():
    txt = _text()
    assert "scripts/autodev_status_dashboard.sh" in txt, (
        "handoff must cite the status dashboard"
    )


def test_cites_l7_launchd_label():
    txt = _text()
    assert "com.lanston.autodev.continuous" in txt, (
        "handoff must reference the L7 launchd label"
    )


def test_mentions_v3_distinction():
    """The handoff should note that v3 (com.autodev.supervisor) is a
    separate, pre-existing agent."""
    txt = _text()
    assert "com.autodev.supervisor" in txt, (
        "handoff should clarify the L7 vs v3 agent distinction"
    )


# --- Quick reference card ---------------------------------------------


def test_has_quick_reference_card():
    txt = _text()
    assert re.search(
        r"##\s+Quick reference", txt, re.IGNORECASE
    ), "missing Quick reference section"


def test_quick_reference_has_install_command():
    txt = _text()
    # Grab the quick-reference block (between its heading and the next ##)
    m = re.search(
        r"##\s+Quick reference[\s\S]*?(?=\n##\s+)", txt, re.IGNORECASE
    )
    assert m is not None
    block = m.group(0)
    assert "--install" in block
    assert "install_launchd_continuous.sh" in block


def test_quick_reference_has_status_command():
    txt = _text()
    m = re.search(
        r"##\s+Quick reference[\s\S]*?(?=\n##\s+)", txt, re.IGNORECASE
    )
    block = m.group(0) if m else ""
    assert "autodev_status_dashboard.sh" in block


def test_quick_reference_has_stopswitch():
    txt = _text()
    m = re.search(
        r"##\s+Quick reference[\s\S]*?(?=\n##\s+)", txt, re.IGNORECASE
    )
    block = m.group(0) if m else ""
    assert "STOPSWITCH" in block


# --- Stop conditions documented ---------------------------------------


def test_mentions_all_stop_conditions():
    txt = _text()
    assert "AUTODEV_DONE.md" in txt
    assert "STOPSWITCH" in txt
    assert "BLOCKED.md" in txt
    assert re.search(r"rate.?limit", txt, re.IGNORECASE) is not None


def test_mentions_45_minute_budget():
    txt = _text()
    assert re.search(r"45[\s\-]?min", txt, re.IGNORECASE), (
        "handoff must mention the 45-min cycle budget"
    )


def test_mentions_15_minute_interval():
    txt = _text()
    assert "15 min" in txt or "15 minute" in txt, (
        "handoff must mention the 15-min launchd dispatch interval"
    )


# --- FAQ + architecture diagram ---------------------------------------


def test_has_faq_section():
    txt = _text()
    assert re.search(r"##\s+FAQ", txt), "missing FAQ section"


def test_has_architecture_section():
    txt = _text()
    assert re.search(
        r"##\s+Architecture", txt, re.IGNORECASE
    ), "missing Architecture section"


def test_has_honest_ceiling_note():
    """Per L7 §1, the system has an honest ceiling. The handoff
    should restate it so operators don't over-expect."""
    txt = _text()
    assert re.search(
        r"(cannot|ceiling|fails at|will fail)", txt, re.IGNORECASE
    ), "handoff should restate the honest ceiling"
