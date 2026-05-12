"""Regression tests for scripts/preflight_failures.py — Track M2.

Greps FAILURES.md against keywords extracted from a PLAN.md so the
planner can be forced to cite prior failures it might be repeating.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import preflight_failures as pf  # noqa: E402


# --- Fixtures --------------------------------------------------------------


SAMPLE_FAILURES = """\
# FAILURES.md

## FAIL-0001: Reviewer rejected TDD-compliant PR for trailing edge-case test
**Symptom**: Issue #14 produced a clean implementation.
**Working fix**: V4 commit 110e7bd rewrote _check_tdd_invariant.
**Keywords**: tdd, reviewer, false-reject, edge-case-test, trailing-test,
commit-prefix-gate, _check_tdd_invariant

## FAIL-0002: Impossible spec looped forever at coding state
**Symptom**: Issue #15 asked for tests of reverse() in src/utils.py.
**Working fix**: V4 commit 110e7bd — new orchestrator/preflight.py module.
**Keywords**: preflight, impossible-spec, blocked-impossible, coding-loop,
infinite-retry, reverse, _do_planning, symbol-absent, forbidden-file

## FAIL-0003: Guardian false-pause on phantom subscription cost
**Keywords**: guardian, false-pause, phantom-cost, subscription, oat01,
billable, cost-mask, record_run, metrics.json
"""


SAMPLE_PLAN = """\
# Cycle 20260512-100000 PLAN

## Target dimension
S

## Change being made
Add a new safety gate that checks reviewer behaviour on edge cases.
We will modify the reviewer pipeline to add a TDD-intent enforcement
check.

## Files to touch
- orchestrator/reviewer.py
- tests/test_reviewer.py

## FAILURES.md pre-flight result
(to be filled by preflight_failures.py)

## Risk score
medium
"""


# --- Keyword extraction ----------------------------------------------------


def test_extract_keywords_from_plan_md():
    keywords = pf.extract_keywords(SAMPLE_PLAN)
    # Should pull at least these tokens from "Change being made" section
    assert "reviewer" in keywords
    assert "tdd" in keywords or "tdd-intent" in keywords
    # Should pull from "Files to touch"
    assert any("reviewer" in k for k in keywords)


def test_extract_keywords_excludes_stopwords():
    text = """## Change being made\nAdd the thing that does stuff with a thing."""
    keywords = pf.extract_keywords(text)
    for stop in ("the", "and", "a", "is", "to", "of", "in"):
        assert stop not in keywords


def test_extract_keywords_normalizes_dashes_and_underscores():
    """tdd-intent, tdd_intent, TDD_intent should all normalise to one form."""
    text = """## Change being made
We update the TDD_intent check and the tdd-intent helper.
"""
    keywords = pf.extract_keywords(text)
    # Normalisation: hyphens and underscores collapsed; lowercase
    assert "tdd_intent" in keywords or "tdd-intent" in keywords or "tdd" in keywords


def test_extract_keywords_handles_empty_plan():
    assert pf.extract_keywords("") == []


# --- FAILURES.md parsing ---------------------------------------------------


def test_parse_failures_returns_entries(tmp_path):
    f = tmp_path / "FAILURES.md"
    f.write_text(SAMPLE_FAILURES)
    entries = pf.parse_failures(f)
    assert len(entries) == 3
    ids = [e.id for e in entries]
    assert "FAIL-0001" in ids
    assert "FAIL-0002" in ids
    assert "FAIL-0003" in ids


def test_parse_failures_extracts_keywords_list(tmp_path):
    f = tmp_path / "FAILURES.md"
    f.write_text(SAMPLE_FAILURES)
    entries = pf.parse_failures(f)
    by_id = {e.id: e for e in entries}
    assert "preflight" in by_id["FAIL-0002"].keywords
    assert "guardian" in by_id["FAIL-0003"].keywords


def test_parse_failures_handles_missing_file(tmp_path):
    assert pf.parse_failures(tmp_path / "nope.md") == []


# --- Matching --------------------------------------------------------------


def test_match_keywords_finds_overlap():
    entries = [
        pf.FailureEntry(id="FAIL-0001", headline="x", keywords=["tdd", "reviewer"]),
        pf.FailureEntry(id="FAIL-0002", headline="y", keywords=["preflight"]),
    ]
    matches = pf.match_keywords(["reviewer", "edge"], entries)
    assert len(matches) == 1
    assert matches[0].entry.id == "FAIL-0001"
    assert "reviewer" in matches[0].matching_keywords


def test_match_keywords_returns_empty_on_no_match():
    entries = [
        pf.FailureEntry(id="FAIL-0001", headline="x", keywords=["tdd"]),
    ]
    assert pf.match_keywords(["unrelated"], entries) == []


def test_match_keywords_scores_by_overlap_count():
    entries = [
        pf.FailureEntry(id="FAIL-0001", headline="x",
                        keywords=["a", "b", "c", "d"]),
        pf.FailureEntry(id="FAIL-0002", headline="y", keywords=["a"]),
    ]
    matches = pf.match_keywords(["a", "b"], entries)
    # 0001 has 2 overlaps; 0002 has 1; 0001 ranks first
    assert matches[0].entry.id == "FAIL-0001"
    assert matches[0].score >= matches[1].score


# --- Real-repo integration -------------------------------------------------


def test_real_repo_failures_md_parses_at_least_3_entries():
    """The committed FAILURES.md must have >=3 entries (V3 #14/#15/#16+)."""
    entries = pf.parse_failures(REPO_ROOT / "FAILURES.md")
    assert len(entries) >= 3


# --- CLI -------------------------------------------------------------------


def _make_cli_files(tmp_path: Path, plan_text: str, failures_text: str):
    plan = tmp_path / "PLAN.md"
    failures = tmp_path / "FAILURES.md"
    plan.write_text(plan_text)
    failures.write_text(failures_text)
    return plan, failures


def test_main_exits_0_on_no_match(tmp_path):
    plan, failures = _make_cli_files(tmp_path,
                                     "## Change being made\nUnrelated XYZZY work\n",
                                     SAMPLE_FAILURES)
    rc = pf.main(["--plan", str(plan), "--failures", str(failures)])
    assert rc == 0


def test_main_exits_1_on_match_default(tmp_path):
    """Default mode treats matches as a soft warning -> exit 1."""
    plan, failures = _make_cli_files(tmp_path, SAMPLE_PLAN, SAMPLE_FAILURES)
    rc = pf.main(["--plan", str(plan), "--failures", str(failures)])
    assert rc == 1


def test_main_strict_passes_when_plan_cites_match(tmp_path):
    """--strict accepts matches IF the PLAN cites the FAIL-NNNN id."""
    cited_plan = SAMPLE_PLAN + "\n\nCites FAIL-0001 for the TDD-intent overlap."
    plan, failures = _make_cli_files(tmp_path, cited_plan, SAMPLE_FAILURES)
    rc = pf.main(["--plan", str(plan), "--failures", str(failures), "--strict"])
    assert rc == 0


def test_main_strict_fails_when_plan_does_not_cite_match(tmp_path):
    plan, failures = _make_cli_files(tmp_path, SAMPLE_PLAN, SAMPLE_FAILURES)
    rc = pf.main(["--plan", str(plan), "--failures", str(failures), "--strict"])
    assert rc == 1


def test_main_json_output(tmp_path, capsys):
    plan, failures = _make_cli_files(tmp_path, SAMPLE_PLAN, SAMPLE_FAILURES)
    pf.main(["--plan", str(plan), "--failures", str(failures), "--json"])
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert "matches" in data
    assert isinstance(data["matches"], list)
    assert "summary" in data


def test_main_handles_missing_plan(tmp_path, capsys):
    failures = tmp_path / "FAILURES.md"
    failures.write_text(SAMPLE_FAILURES)
    rc = pf.main(["--plan", str(tmp_path / "nope.md"),
                  "--failures", str(failures)])
    # Missing PLAN is a 2 (usage error), not 0/1
    assert rc == 2


def test_main_handles_missing_failures(tmp_path):
    plan = tmp_path / "PLAN.md"
    plan.write_text(SAMPLE_PLAN)
    rc = pf.main(["--plan", str(plan),
                  "--failures", str(tmp_path / "nope.md")])
    # Missing FAILURES is treated as "no entries to match" → rc=0
    assert rc == 0
