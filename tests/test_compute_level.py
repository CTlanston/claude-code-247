"""Regression tests for scripts/compute_level.py.

Per L7 §9. Each dimension's level boundaries are tested. The tests build
synthetic repo layouts in tmp_path and call the pure `compute_levels()`
function — no actual filesystem mutation outside tmp_path.

Coverage goals:
- Each dim has >= 1 test covering the L3 baseline
- Each dim has >= 1 test covering at least one L>3 upgrade
- --check mode regression detection has its own tests
- render_level_md / parse_level_md round-trip
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import compute_level as cl  # noqa: E402  (path inserted just above)


# --- Helpers ---------------------------------------------------------------


def _seed_minimal_l3_repo(tmp_path: Path) -> Path:
    """Create the absolute minimum file layout to hit L3 across the board."""
    (tmp_path / "CHANGELOG.md").write_text(
        "20260101-000000 | M | bootstrap | PASS\n"
    )
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_dummy.py").write_text(
        "def test_dummy(): pass\n"
    )
    (tmp_path / "orchestrator").mkdir()
    (tmp_path / "orchestrator" / "roles").mkdir()
    (tmp_path / "orchestrator" / "roles" / "reviewer.md").write_text(
        "# Reviewer role\n"
    )
    # git init so worktree count works (returns 1 for single)
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    return tmp_path


def _add_context_and_adrs(repo: Path, n_adrs: int = 3) -> None:
    (repo / "CONTEXT.md").write_text(
        "# CONTEXT.md\n\n## 1. System\n\nTest.\n"
    )
    adr_dir = repo / "docs" / "adr"
    adr_dir.mkdir(parents=True, exist_ok=True)
    for i in range(n_adrs):
        (adr_dir / f"{i:04d}-test-adr.md").write_text(
            f"# ADR-{i:04d}: test\n\n## Context\n\n## Decision\n"
        )


def _add_failures(repo: Path, n: int) -> None:
    lines = ["# FAILURES.md\n"]
    for i in range(1, n + 1):
        lines.append(f"## FAIL-{i:04d}: test failure {i}\n")
        lines.append(f"**Symptom**: thing {i}\n")
    (repo / "FAILURES.md").write_text("\n".join(lines))


def _add_gate(repo: Path, gate_name: str) -> None:
    """Seed the orchestrator + tests files for a specific known gate so it
    counts as 'active' in safety_dim.

    Uses APPEND mode for test files because multiple gates can share the
    same test file (e.g. test_v4_hardening.py covers both tdd_invariant
    and preflight) and overwrite would clobber the prior gate's keyword.
    """
    gate = next(g for g in cl.KNOWN_GATES if g["name"] == gate_name)
    # Create at least one module path
    mp = repo / gate["module_paths"][0]
    mp.parent.mkdir(parents=True, exist_ok=True)
    if not mp.exists():
        mp.write_text("# gate module\n")
    else:
        mp.write_text(mp.read_text() + "\n# gate module also for "
                      + gate_name + "\n")
    # Append (don't overwrite) a test stub with the gate's keyword
    tp = repo / gate["test_paths"][0]
    tp.parent.mkdir(parents=True, exist_ok=True)
    keyword = gate["keywords"][0]
    existing = tp.read_text() if tp.exists() else ""
    tp.write_text(existing + f"def test_{gate_name}(): assert '{keyword}'\n")


# --- Helper-function tests ------------------------------------------------


def test_count_failures_entries(tmp_path):
    f = tmp_path / "FAILURES.md"
    f.write_text(
        "# FAILURES.md\n"
        "## FAIL-0001: a\n"
        "stuff\n"
        "## FAIL-0042: b\n"
        "more stuff\n"
    )
    assert cl._count_failures_entries(f) == 2


def test_count_adrs(tmp_path):
    adr = tmp_path / "docs" / "adr"
    adr.mkdir(parents=True)
    (adr / "0001-foo.md").write_text("x")
    (adr / "0002-bar.md").write_text("x")
    (adr / "not-an-adr.md").write_text("x")  # ignored — no NNNN prefix
    (adr / "9999-baz.md").write_text("x")
    assert cl._count_adrs(adr) == 3


def test_file_contains_any_keywords(tmp_path):
    f = tmp_path / "x.py"
    f.write_text("from preflight import preflight_issue\n")
    assert cl._file_contains_any(f, ["preflight"]) is True
    assert cl._file_contains_any(f, ["xyzzy"]) is False
    # Case-insensitive
    assert cl._file_contains_any(f, ["PREFLIGHT"]) is True


# --- M-dim tests ----------------------------------------------------------


def test_memory_l3_baseline(tmp_path):
    """CHANGELOG.md alone with no CONTEXT/ADR/FAILURES = L3."""
    _seed_minimal_l3_repo(tmp_path)
    result = cl.memory_dim(tmp_path)
    assert result.level == 3
    assert any("CHANGELOG.md present" in e for e in result.evidence)


def test_memory_l4_when_context_and_3_adrs(tmp_path):
    """CONTEXT.md + 3 ADRs upgrades to L4."""
    _seed_minimal_l3_repo(tmp_path)
    _add_context_and_adrs(tmp_path, n_adrs=3)
    result = cl.memory_dim(tmp_path)
    assert result.level == 4


def test_memory_l4_blocked_at_l5_when_failures_under_10(tmp_path):
    """CONTEXT + 3 ADRs but only 4 FAILURES = L4 (need 10 for L5)."""
    _seed_minimal_l3_repo(tmp_path)
    _add_context_and_adrs(tmp_path, n_adrs=5)
    _add_failures(tmp_path, n=4)
    result = cl.memory_dim(tmp_path)
    assert result.level == 4


def test_memory_l5_when_failures_10_and_preflight_script(tmp_path):
    """10+ FAILURES + preflight_failures.py script = L5."""
    _seed_minimal_l3_repo(tmp_path)
    _add_context_and_adrs(tmp_path, n_adrs=5)
    _add_failures(tmp_path, n=12)
    (tmp_path / "scripts").mkdir(exist_ok=True)
    (tmp_path / "scripts" / "preflight_failures.py").write_text("# stub\n")
    result = cl.memory_dim(tmp_path)
    assert result.level == 5


# --- S-dim tests ----------------------------------------------------------


def test_safety_l3_when_no_gates(tmp_path):
    """No known gates active = L3 baseline."""
    _seed_minimal_l3_repo(tmp_path)
    result = cl.safety_dim(tmp_path)
    assert result.level == 3
    assert "0 active gates" in result.evidence[0]


def test_safety_l5_with_3_gates(tmp_path):
    """3 gates → min(7, 2+3) = L5. Matches Cycle 0 state in the real repo."""
    _seed_minimal_l3_repo(tmp_path)
    _add_gate(tmp_path, "guardian_cost")
    _add_gate(tmp_path, "tdd_invariant")
    _add_gate(tmp_path, "preflight")
    result = cl.safety_dim(tmp_path)
    assert result.level == 5


def test_safety_l7_caps_at_7_with_many_gates(tmp_path):
    """All 7 known gates → L7 (clamped)."""
    _seed_minimal_l3_repo(tmp_path)
    for g in cl.KNOWN_GATES:
        _add_gate(tmp_path, g["name"])
    result = cl.safety_dim(tmp_path)
    assert result.level == 7


def test_safety_gate_inactive_when_test_lacks_keyword(tmp_path):
    """Module present but the test doesn't reference the gate → inactive."""
    _seed_minimal_l3_repo(tmp_path)
    # Hand-craft so module is there but test doesn't have the keyword
    mp = tmp_path / "orchestrator" / "preflight.py"
    mp.write_text("# preflight\n")
    tp = tmp_path / "tests" / "test_v4_hardening.py"
    tp.write_text("def test_unrelated(): pass\n")  # no 'preflight'/'impossible_spec'
    result = cl.safety_dim(tmp_path)
    # Should not count the preflight gate
    assert "preflight" not in (result.evidence[0] if result.evidence else "")


# --- R-dim tests ----------------------------------------------------------


def test_review_l3_with_single_reviewer(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    result = cl.review_dim(tmp_path)
    assert result.level == 3


def test_review_l5_when_codex_active(tmp_path):
    """R-L5 requires (a) module + test files AND (b) `codex` on PATH.
    Mock shutil.which to simulate Codex being installed locally."""
    _seed_minimal_l3_repo(tmp_path)
    (tmp_path / "orchestrator" / "codex_reviewer.py").write_text("# codex stub\n")
    (tmp_path / "tests" / "test_codex_reviewer.py").write_text(
        "def test_codex_path(): assert 'codex' == 'codex'\n"
    )
    from unittest.mock import patch
    with patch("shutil.which", return_value="/usr/local/bin/codex"):
        result = cl.review_dim(tmp_path)
    assert result.level == 5


def test_review_stays_l3_when_codex_artifacts_present_but_binary_missing(tmp_path):
    """Honesty check: even with the bridge code in place, R stays at L3
    until `codex` is actually on PATH. Prevents false-claim L5."""
    _seed_minimal_l3_repo(tmp_path)
    (tmp_path / "orchestrator" / "codex_reviewer.py").write_text("# codex stub\n")
    (tmp_path / "tests" / "test_codex_reviewer.py").write_text(
        "def test_codex_path(): assert 'codex' == 'codex'\n"
    )
    from unittest.mock import patch
    with patch("shutil.which", return_value=None):
        result = cl.review_dim(tmp_path)
    assert result.level == 3


# --- C-dim tests ----------------------------------------------------------


def test_concurrency_l3_single_stream(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    result = cl.concurrency_dim(tmp_path)
    assert result.level == 3


# --- T-dim tests ----------------------------------------------------------


def test_test_oracle_l3_baseline(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    result = cl.test_dim(tmp_path)
    assert result.level == 3


def test_test_oracle_l4_with_3_property_files(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    for name in ("billable", "preflight", "tdd_intent"):
        (tmp_path / "tests" / f"test_{name}_properties.py").write_text(
            "def test_prop(): pass\n"
        )
    result = cl.test_dim(tmp_path)
    assert result.level == 4


# --- E-dim tests ----------------------------------------------------------


def test_self_improvement_l3_manual(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    result = cl.self_improvement_dim(tmp_path)
    assert result.level == 3


def test_self_improvement_l4_when_script_exists(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    (tmp_path / "scripts").mkdir(exist_ok=True)
    (tmp_path / "scripts" / "propose_next_track.py").write_text("# stub\n")
    result = cl.self_improvement_dim(tmp_path)
    assert result.level == 4


# --- Composite + I/O tests ------------------------------------------------


def test_compute_levels_overall_is_min_across_dims(tmp_path):
    """Overall L = min(dim levels). Bootstrap repo should be L3."""
    _seed_minimal_l3_repo(tmp_path)
    _add_context_and_adrs(tmp_path, n_adrs=5)  # M=L4
    _add_gate(tmp_path, "guardian_cost")
    _add_gate(tmp_path, "tdd_invariant")
    _add_gate(tmp_path, "preflight")           # S=L5
    # R/C/T/E stay at L3
    report = cl.compute_levels(tmp_path)
    assert report.by_dim["M"].level == 4
    assert report.by_dim["S"].level == 5
    assert report.by_dim["R"].level == 3
    assert report.by_dim["C"].level == 3
    assert report.by_dim["T"].level == 3
    assert report.by_dim["E"].level == 3
    assert report.overall == 3


def test_render_and_parse_round_trip(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    report = cl.compute_levels(tmp_path)
    rendered = cl.render_level_md(report)
    out = tmp_path / "LEVEL.md"
    out.write_text(rendered)
    parsed = cl.parse_level_md(out)
    for dim in cl.DIMS:
        assert parsed[dim] == report.by_dim[dim].level


def test_parse_level_md_returns_empty_when_missing(tmp_path):
    assert cl.parse_level_md(tmp_path / "nonexistent.md") == {}


def test_main_writes_level_md(tmp_path, monkeypatch, capsys):
    _seed_minimal_l3_repo(tmp_path)
    rc = cl.main(["--repo-root", str(tmp_path)])
    assert rc == 0
    assert (tmp_path / "LEVEL.md").exists()
    text = (tmp_path / "LEVEL.md").read_text()
    for dim in cl.DIMS:
        assert f"{dim} " in text


def test_main_check_passes_when_no_regression(tmp_path):
    _seed_minimal_l3_repo(tmp_path)
    # First write
    rc = cl.main(["--repo-root", str(tmp_path)])
    assert rc == 0
    # Now --check against the same state
    rc2 = cl.main(["--repo-root", str(tmp_path), "--check"])
    assert rc2 == 0


def test_main_check_fails_on_regression(tmp_path):
    """If existing LEVEL.md claims higher levels than current state, fail."""
    _seed_minimal_l3_repo(tmp_path)
    # Hand-write a LEVEL.md claiming L7 across the board
    (tmp_path / "LEVEL.md").write_text(
        "# LEVEL.md\n\n"
        "M 7 | evidence: x\n"
        "S 7 | evidence: x\n"
        "R 7 | evidence: x\n"
        "C 7 | evidence: x\n"
        "T 7 | evidence: x\n"
        "E 7 | evidence: x\n"
        "\nOverall L = 7\n"
    )
    rc = cl.main(["--repo-root", str(tmp_path), "--check"])
    assert rc == 1


def test_main_json_output(tmp_path, capsys):
    _seed_minimal_l3_repo(tmp_path)
    rc = cl.main(["--repo-root", str(tmp_path), "--json"])
    assert rc == 0
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert "by_dim" in data
    assert "overall" in data
    assert set(data["by_dim"].keys()) == set(cl.DIMS)


# --- Refusal-count regression tests (Track M5) ----------------------------


def _write_plan(repo: Path, cycle_id: str, content: str) -> None:
    (repo / "cycles" / cycle_id).mkdir(parents=True, exist_ok=True)
    (repo / "cycles" / cycle_id / "PLAN.md").write_text(content)


def test_refusal_count_legacy_picked_phrase(tmp_path):
    _write_plan(tmp_path, "20260101-000001",
                "## FAILURES.md pre-flight\n\n"
                "FAIL-0001 was flagged. Picked a different approach.\n")
    assert cl._count_planner_refusals(tmp_path / "cycles") == 1


def test_refusal_count_new_cited_phrase(tmp_path):
    """The widened regex should accept the L7-canonical citation language."""
    _write_plan(tmp_path, "20260101-000001",
                "## FAILURES.md pre-flight\n\n"
                "**FAIL-0003** matched on 'subscription'. Cited here.\n"
                "Different subscription, different system.\n")
    n = cl._count_planner_refusals(tmp_path / "cycles")
    assert n == 1, f"new wording not recognised; got {n}"


def test_refusal_count_sibling_phrase(tmp_path):
    _write_plan(tmp_path, "20260101-000001",
                "## FAILURES.md pre-flight\n\n"
                "FAIL-0007: sibling failure. Not a repeat — this cycle\n"
                "ADDS a sibling gate.\n")
    n = cl._count_planner_refusals(tmp_path / "cycles")
    assert n == 1, f"sibling-language not recognised; got {n}"


def test_refusal_count_unrelated_FAIL_mention_does_not_count(tmp_path):
    """A bare FAIL-NNNN mention without citation context should NOT count."""
    _write_plan(tmp_path, "20260101-000001",
                "## Notes\n\nSee FAIL-0001 for historical context.\n")
    # No citation explanation → shouldn't count
    n = cl._count_planner_refusals(tmp_path / "cycles")
    assert n == 0


def test_refusal_count_real_repo_is_at_least_3(tmp_path, monkeypatch):
    """The committed cycles/*/PLAN.md should yield refusal count >= 3
    (cycles 2, 5, 7, 9, 11 cite FAIL-NNNN entries)."""
    real_cycles = REPO_ROOT / "cycles"
    n = cl._count_planner_refusals(real_cycles)
    assert n >= 3, (
        f"refusal count is {n}; expected >=3 from committed PLANs. "
        "If this fails, widen the regex more."
    )
