"""Regression tests for scripts/cluster_failures.py (Track M3)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import cluster_failures as cf  # noqa: E402
import preflight_failures as pf  # noqa: E402


# --- Jaccard helper -------------------------------------------------------


def test_jaccard_identity():
    assert cf.jaccard({"a", "b", "c"}, {"a", "b", "c"}) == 1.0


def test_jaccard_disjoint():
    assert cf.jaccard({"a", "b"}, {"c", "d"}) == 0.0


def test_jaccard_partial():
    # {a,b,c} vs {a,b,d}: intersection={a,b}, union={a,b,c,d}; J=2/4=0.5
    assert cf.jaccard({"a", "b", "c"}, {"a", "b", "d"}) == 0.5


def test_jaccard_empty_sets_returns_zero():
    assert cf.jaccard(set(), set()) == 0.0
    assert cf.jaccard({"a"}, set()) == 0.0


# --- Clustering ----------------------------------------------------------


def _entries_from_tuples(triples):
    """Helper: build FailureEntry list from (id, keywords) tuples."""
    return [pf.FailureEntry(id=fid, headline="hl", keywords=kws)
            for fid, kws in triples]


def test_single_entry_one_singleton_cluster():
    entries = _entries_from_tuples([("FAIL-0001", ["a", "b", "c"])])
    clusters = cf.cluster_entries(entries, threshold=0.2)
    assert len(clusters) == 1
    assert clusters[0].members == ["FAIL-0001"]


def test_two_high_overlap_entries_one_cluster():
    entries = _entries_from_tuples([
        ("FAIL-0001", ["alpha", "beta", "gamma", "delta"]),
        ("FAIL-0002", ["alpha", "beta", "gamma", "delta"]),  # identical
    ])
    clusters = cf.cluster_entries(entries, threshold=0.2)
    assert len(clusters) == 1
    assert set(clusters[0].members) == {"FAIL-0001", "FAIL-0002"}


def test_two_disjoint_entries_two_clusters():
    entries = _entries_from_tuples([
        ("FAIL-0001", ["alpha", "beta", "gamma"]),
        ("FAIL-0002", ["delta", "epsilon", "zeta"]),
    ])
    clusters = cf.cluster_entries(entries, threshold=0.2)
    assert len(clusters) == 2


def test_threshold_changes_grouping():
    """At threshold 0.5, two entries with 1-of-4 keyword overlap don't cluster;
    at threshold 0.1, they do."""
    entries = _entries_from_tuples([
        ("FAIL-0001", ["alpha", "beta", "gamma", "delta"]),
        ("FAIL-0002", ["alpha", "x", "y", "z"]),  # only "alpha" shared, J=1/7
    ])
    high = cf.cluster_entries(entries, threshold=0.5)
    low = cf.cluster_entries(entries, threshold=0.1)
    assert len(high) == 2  # disjoint
    assert len(low) == 1   # merged


def test_empty_input_returns_empty_list():
    assert cf.cluster_entries([], threshold=0.2) == []


# --- Real-repo integration ------------------------------------------------


def test_real_failures_produce_at_least_one_cluster():
    """The committed FAILURES.md must produce at least 1 cluster (10 entries
    can't all be singletons after analysis)."""
    entries = pf.parse_failures(REPO_ROOT / "FAILURES.md")
    clusters = cf.cluster_entries(entries, threshold=0.20)
    assert len(clusters) >= 1
    assert sum(len(c.members) for c in clusters) == len(entries)


# --- CLI ------------------------------------------------------------------


def test_main_writes_report(tmp_path):
    """main writes both .md and .json reports."""
    failures = tmp_path / "FAILURES.md"
    failures.write_text(
        "# FAILURES.md\n"
        "## FAIL-0001: a\n**Keywords**: alpha, beta\n"
        "## FAIL-0002: b\n**Keywords**: alpha, gamma\n"
    )
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    rc = cf.main([
        "--failures", str(failures),
        "--out-md", str(reports_dir / "failure-clusters.md"),
        "--out-json", str(reports_dir / "failure-clusters.json"),
    ])
    assert rc == 0
    assert (reports_dir / "failure-clusters.md").exists()
    assert (reports_dir / "failure-clusters.json").exists()
    data = json.loads((reports_dir / "failure-clusters.json").read_text())
    assert "clusters" in data
