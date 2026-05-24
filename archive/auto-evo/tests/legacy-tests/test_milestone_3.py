"""Structural tests for reports/milestone-3.md (Cycle 31).

Per L7 §18, milestone reports must include cumulative progress,
level-up events with root causes, FAILURES growth, top patterns,
spend, honest assessment, and recommendations. These tests pin
the required sections so a future edit can't silently drop one.
"""
from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DOC = REPO_ROOT / "reports" / "milestone-3.md"


def _text() -> str:
    return DOC.read_text(encoding="utf-8")


# --- Existence + size ---------------------------------------------------


def test_doc_exists():
    assert DOC.exists()


def test_doc_nontrivial_size():
    """Milestone reports should be > 4 KB."""
    assert len(_text()) > 4000, (
        "milestone-3 must be > 4 KB; smaller suggests truncation"
    )


# --- 9 canonical sections (per PLAN) -----------------------------------


def test_section_1_cumulative_level_progress():
    assert re.search(
        r"##\s+§?1\b.*level progress", _text(), re.IGNORECASE
    ), "missing §1 cumulative level progress"


def test_section_2_level_up_events():
    assert re.search(
        r"##\s+§?2\b.*level[- ]up event", _text(), re.IGNORECASE
    ), "missing §2 level-up events"


def test_section_3_failures_md_summary():
    assert re.search(
        r"##\s+§?3\b.*FAILURES", _text()
    ), "missing §3 FAILURES.md summary"


def test_section_4_top_patterns():
    assert re.search(
        r"##\s+§?4\b.*pattern", _text(), re.IGNORECASE
    ), "missing §4 top patterns"


def test_section_5_codex_spend():
    assert re.search(
        r"##\s+§?5\b.*codex|##\s+§?5\b.*spend", _text(), re.IGNORECASE
    ), "missing §5 codex spend"


def test_section_6_honest_assessment():
    assert re.search(
        r"##\s+§?6\b.*(honest|assessment)", _text(), re.IGNORECASE
    ), "missing §6 honest assessment"


def test_section_7_test_growth():
    assert re.search(
        r"##\s+§?7\b.*test", _text(), re.IGNORECASE
    ), "missing §7 test growth"


def test_section_8_recommended_tracks():
    assert re.search(
        r"##\s+§?8\b.*(recommend|next 30 cycle)", _text(), re.IGNORECASE
    ), "missing §8 recommended tracks"


def test_section_9_operator_role():
    assert re.search(
        r"##\s+§?9\b.*(operator|role)", _text(), re.IGNORECASE
    ), "missing §9 operator's role"


# --- Required tables / content -----------------------------------------


def test_has_cumulative_level_table():
    """The cumulative table should have header rows for Bootstrap,
    Milestone 2 / 3 columns, and the 6 rubric dims."""
    txt = _text()
    assert "Bootstrap" in txt
    for dim in ["M", "S", "R", "C", "T", "E"]:
        # Each dim line should appear in a table-like row
        assert re.search(rf"\b{dim}\b", txt), f"dim {dim} missing"


def test_mentions_all_5_max_dims():
    """5 of 6 dims at L7 (M/S/R/T/E); C at L4."""
    txt = _text()
    # "max" appears in the cumulative table
    assert txt.count("max") >= 5, (
        "expected at least 5 mentions of 'max' for dims at L7"
    )


def test_mentions_c_streak_progress():
    txt = _text()
    assert re.search(r"\b11/30\b|streak.{0,40}11", txt), (
        "milestone must report current C streak progress"
    )


def test_mentions_30_cycle_target():
    txt = _text()
    assert "30-cycle" in txt or "30 cycle" in txt or "30-cycle " in txt, (
        "must mention the 30-cycle threshold for C-L5"
    )


def test_mentions_500_tests():
    """The half-thousand-tests milestone is the headline number."""
    txt = _text()
    assert "500" in txt, "must mention the 500-test milestone"


def test_mentions_phase_b_complete():
    """Phase B is the focal point of this milestone window."""
    txt = _text()
    assert re.search(r"Phase B", txt), "must reference Phase B"


def test_mentions_phase_c_complete():
    txt = _text()
    assert re.search(r"Phase C", txt), "must reference Phase C"


def test_cites_fail_0007_disambiguation():
    """The §6/§9 use of "role" needs to disambiguate from FAIL-0007."""
    txt = _text()
    assert "FAIL-0007" in txt, (
        "milestone must cite FAIL-0007 for the 'role' disambiguation"
    )


def test_cites_fail_0009():
    """FAIL-0009 (doctor session-log) is the named risk for the
    launchd-driven path."""
    txt = _text()
    assert "FAIL-0009" in txt, (
        "milestone must surface FAIL-0009 as the named risk"
    )


def test_cites_propose_next_track():
    """The procedural-lesson pattern is named."""
    txt = _text()
    assert "propose_next_track" in txt, (
        "milestone must mention the propose_next_track ordering lesson"
    )


def test_cites_l7_installer_path():
    """The handoff-step recommendation at the end must cite the
    correct install command."""
    txt = _text()
    assert "install_launchd_continuous.sh" in txt, (
        "milestone must cite the L7 installer path"
    )


# --- Honest-assessment markers ------------------------------------------


def test_honest_assessment_includes_caveats():
    """§6 must surface both what's better AND what's not."""
    txt = _text()
    # The "not better" section should explicitly call out C streak
    # not being done yet
    assert re.search(
        r"(not.{0,20}better|caveat|risk|honest)", txt, re.IGNORECASE
    ), "§6 must surface caveats / honest assessment"


def test_honest_ceiling_restated():
    """L7 §1 honest ceiling: the system has known limits."""
    txt = _text()
    assert re.search(
        r"(ceiling|fail|limit|excellent at|mediocre at)", txt,
        re.IGNORECASE
    ), "honest ceiling must be restated"


# --- Forward-looking recommendation ------------------------------------


def test_recommendations_acknowledge_c_streak_path():
    """§8 must say something about needing ~19-24 disciplined cycles
    for the C streak."""
    txt = _text()
    assert re.search(
        r"(19|20|21|22|23|24).{0,30}(cycle|streak)", txt, re.IGNORECASE
    ), "§8 must give a realistic C-streak count for next-30"


def test_recommendations_mention_target_l_raise():
    """When Overall reaches 5, the operator can raise AUTODEV_TARGET_L."""
    txt = _text()
    assert "AUTODEV_TARGET_L" in txt, (
        "§8 or §9 must mention raising AUTODEV_TARGET_L"
    )
