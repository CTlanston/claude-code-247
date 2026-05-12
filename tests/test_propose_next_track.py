"""Regression tests for scripts/propose_next_track.py — Track E2.

Reads LEVEL.md + FAILURES.md + BACKLOG.md and proposes the next track
to work on. The script is the L7 §9 "self-improvement" advance.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import propose_next_track as pnt  # noqa: E402


# --- Fixtures --------------------------------------------------------------


SAMPLE_LEVEL = """\
# LEVEL.md
M 5 | evidence: x
S 5 | evidence: x
R 3 | evidence: x
C 3 | evidence: x
T 3 | evidence: x
E 3 | evidence: x

Overall L = 3
"""


SAMPLE_FAILURES = """\
# FAILURES.md

## FAIL-0007: record_run double-write phantom-cost rows
**Working fix**: planned (NOT YET SHIPPED).
**Keywords**: record_run, idempotency, double-write, phantom-cost

## FAIL-0008: .dockerignore missing
**Working fix**: planned (NOT YET SHIPPED).
**Keywords**: dockerignore, image-bloat, build-context
"""


SAMPLE_BACKLOG = """\
# BACKLOG.md

## P0 — immediate next cycle

- [ ] [Track E2] Implement scripts/propose_next_track.py (priority: P0)
      details: stuff
      rubric dim: E (Self-improvement) — moves L3 → L4

- [ ] [Track T2-property-billable] Add Hypothesis properties (priority: P0)
      details: stuff
      rubric dim: T (Test oracle) — partial step toward L4

## P1 — next 3 cycles

- [ ] [Track S2] Promote preflight from V4-implemented to first-class (priority: P1)
      details: ...
      rubric dim: S (Safety)

- [ ] [Track FIX-007] Idempotent record_run (priority: P1)
      details: addresses record_run double-write
      rubric dim: S — moves L5 → L6

## Completed

- [x] [Track M2] DONE in 20260512-043811
"""


# --- Parsing ---------------------------------------------------------------


def test_parse_level_md_text():
    levels = pnt.parse_level_md_text(SAMPLE_LEVEL)
    assert levels == {"M": 5, "S": 5, "R": 3, "C": 3, "T": 3, "E": 3}


def test_parse_backlog_open_items():
    items = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    open_items = [i for i in items if i.status == "open"]
    assert len(open_items) == 4
    ids = [i.track_id for i in open_items]
    assert "Track E2" in ids
    assert "Track T2-property-billable" in ids
    assert "Track S2" in ids
    assert "Track FIX-007" in ids


def test_parse_backlog_priorities():
    items = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    by_id = {i.track_id: i for i in items}
    assert by_id["Track E2"].priority == "P0"
    assert by_id["Track S2"].priority == "P1"


def test_parse_backlog_dim_labels():
    items = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    by_id = {i.track_id: i for i in items}
    assert by_id["Track E2"].dim == "E"
    assert by_id["Track T2-property-billable"].dim == "T"
    assert by_id["Track S2"].dim == "S"


def test_parse_backlog_done_items_marked():
    items = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    done = [i for i in items if i.status == "done"]
    assert len(done) == 1
    assert done[0].track_id == "Track M2"


# --- Scoring + selection ---------------------------------------------------


def test_score_prefers_floor_dim():
    """When two P0 tracks exist, prefer the one whose dim is at floor."""
    levels = {"M": 5, "S": 5, "R": 3, "C": 3, "T": 3, "E": 3}
    backlog = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    failures = pnt.parse_failures_text(SAMPLE_FAILURES)
    proposal = pnt.propose(levels, backlog, failures)
    # Both Track E2 and Track T2 target floor dims (E=3 and T=3, tied).
    # Chosen track must be one of them.
    assert proposal.chosen.track_id in {"Track E2",
                                         "Track T2-property-billable"}


def test_score_p0_beats_p1():
    """A P0 track on a floor dim should beat a P1 track on a non-floor dim."""
    levels = {"M": 5, "S": 5, "R": 3, "C": 3, "T": 3, "E": 3}
    backlog = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    proposal = pnt.propose(levels, backlog, failures=[])
    # Top alternative should be P0 (E2 or T2), not P1 (S2)
    assert proposal.chosen.priority == "P0"


def test_score_avoids_unfixed_failure_overlap():
    """Track FIX-007's description matches FAIL-0007 (record_run, idempotency).
    With failure penalty, it shouldn't be chosen over E2/T2/S2."""
    levels = {"M": 5, "S": 5, "R": 3, "C": 3, "T": 3, "E": 3}
    backlog = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    failures = pnt.parse_failures_text(SAMPLE_FAILURES)
    proposal = pnt.propose(levels, backlog, failures)
    # Even though FIX-007 lifts S, the unfixed-failure-keyword overlap
    # docks it; chosen should be E2 or T2 (P0 floor-dim moves).
    assert proposal.chosen.track_id != "Track FIX-007"


def test_propose_returns_at_least_one_alternative():
    levels = {"M": 5, "S": 5, "R": 3, "C": 3, "T": 3, "E": 3}
    backlog = pnt.parse_backlog_text(SAMPLE_BACKLOG)
    proposal = pnt.propose(levels, backlog, failures=[])
    assert len(proposal.alternatives) >= 1


def test_propose_empty_backlog_returns_none():
    levels = {"M": 3, "S": 3, "R": 3, "C": 3, "T": 3, "E": 3}
    proposal = pnt.propose(levels, backlog=[], failures=[])
    assert proposal.chosen is None
    assert proposal.alternatives == []


# --- Real-repo integration -------------------------------------------------


def test_real_repo_proposes_a_track():
    """End-to-end: read real LEVEL/BACKLOG/FAILURES and emit a sensible
    proposal."""
    proposal = pnt.propose_from_repo(REPO_ROOT)
    assert proposal.chosen is not None
    # Real repo has Track E2 as P0 (this very cycle); should be picked OR
    # already DONE by the time this test runs in a future cycle, in which
    # case any other P0 is acceptable.
    assert proposal.chosen.priority in {"P0", "P1"}


# --- CLI -------------------------------------------------------------------


def test_main_json_output(tmp_path, monkeypatch, capsys):
    # Build a tmp repo with minimal LEVEL/BACKLOG/FAILURES
    (tmp_path / "LEVEL.md").write_text(SAMPLE_LEVEL)
    (tmp_path / "BACKLOG.md").write_text(SAMPLE_BACKLOG)
    (tmp_path / "FAILURES.md").write_text(SAMPLE_FAILURES)
    rc = pnt.main(["--repo-root", str(tmp_path), "--json"])
    assert rc == 0
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert "chosen" in data
    assert "alternatives" in data
    assert "reasoning" in data


def test_main_writes_proposal_for_cycle(tmp_path):
    (tmp_path / "LEVEL.md").write_text(SAMPLE_LEVEL)
    (tmp_path / "BACKLOG.md").write_text(SAMPLE_BACKLOG)
    (tmp_path / "FAILURES.md").write_text(SAMPLE_FAILURES)
    cycle_id = "99999999-999999"
    (tmp_path / "cycles" / cycle_id).mkdir(parents=True)
    rc = pnt.main(["--repo-root", str(tmp_path),
                   "--for-cycle", cycle_id])
    assert rc == 0
    proposal_file = tmp_path / "cycles" / cycle_id / "next-track-proposal.json"
    assert proposal_file.exists()
    data = json.loads(proposal_file.read_text())
    assert data["chosen"]["track_id"] in {"Track E2",
                                          "Track T2-property-billable"}
