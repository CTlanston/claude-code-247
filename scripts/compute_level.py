#!/usr/bin/env python3
"""compute_level.py — L7 rubric scorer for AutoDev L7

This is the SOLE authority on LEVEL.md. NEVER hand-edit LEVEL.md.

Per §3 (rubric table) and §9 (implementation logic) of
``AUTODEV_L7_MASTER_PROMPT.md``. Six dimensions: M, S, R, C, T, E.
Overall L = min(dim levels).

Usage:
    scripts/compute_level.py                 # compute and write LEVEL.md
    scripts/compute_level.py --check         # exit 1 if any dim regressed
                                              # vs. existing LEVEL.md
    scripts/compute_level.py --json          # print machine-readable JSON
    scripts/compute_level.py --verbose       # explain each dim's evidence

Design constraints:
  - Pure function `compute_levels(repo_root)` for testability
  - All side effects (file write, stdout) live in `main()`
  - Evidence detection is deterministic and uses ONLY filesystem state
    + git metadata. No network. No LLM calls.
  - Adding a new gate/feature = extend the relevant KNOWN_* list +
    one regression test. No formula changes.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# --- Configuration ---------------------------------------------------------

DIMS = ("M", "S", "R", "C", "T", "E")


# Safety gates known to L7. Each has a module marker + at least one test
# file that references it. Adding a new gate in a future cycle = append
# here + ensure the regression test is in place.
KNOWN_GATES = [
    {
        "name": "guardian_cost",
        "module_paths": ["orchestrator/main.py", "autodev/cost_policy.py"],
        "test_paths": ["tests/test_autodev_cost_policy.py",
                       "tests/test_v4_hardening.py",
                       "tests/test_v4_e2e_replay.py"],
        "keywords": ["guardian", "subscription", "billable",
                     "is_subscription_mode", "to_billable_cost"],
    },
    {
        "name": "tdd_invariant",
        "module_paths": ["orchestrator/main.py"],
        "module_symbols": ["_check_tdd_invariant"],
        "test_paths": ["tests/test_v4_hardening.py",
                       "tests/test_v4_e2e_replay.py"],
        "keywords": ["tdd_intent", "_check_tdd_invariant", "tdd"],
    },
    {
        "name": "preflight",
        "module_paths": ["orchestrator/preflight.py"],
        "test_paths": ["tests/test_v4_hardening.py",
                       "tests/test_v4_e2e_replay.py"],
        "keywords": ["preflight", "preflight_issue", "impossible_spec"],
    },
    {
        "name": "intake_sanitizer",
        "module_paths": ["orchestrator/intake_sanitizer.py"],
        "test_paths": ["tests/test_intake_sanitizer.py"],
        "keywords": ["sanitize", "prompt_injection"],
    },
    {
        "name": "action_layer_evaluator",
        "module_paths": ["orchestrator/action_evaluator.py"],
        "test_paths": ["tests/test_action_evaluator.py"],
        "keywords": ["action_eval", "score_action"],
    },
    {
        "name": "adversarial_return_check",
        "module_paths": ["orchestrator/adversarial_return.py"],
        "test_paths": ["tests/test_adversarial_return.py"],
        "keywords": ["adversarial_return", "subagent_return"],
    },
    {
        "name": "canary_leakage_scan",
        "module_paths": ["orchestrator/canary_scan.py"],
        "test_paths": ["tests/test_canary_scan.py"],
        "keywords": ["canary"],
    },
]


# Review-dim evidence markers.
REVIEW_MARKERS = {
    "codex_bridge": {
        "module_paths": ["orchestrator/codex_reviewer.py"],
        "test_paths": ["tests/test_codex_reviewer.py"],
        "keywords": ["codex"],
    },
    "adversarial_reviewer": {
        "module_paths": ["orchestrator/adversarial_reviewer.py",
                         "orchestrator/roles/adversarial_reviewer.md",
                         "runner/roles/adversarial_reviewer.md"],
        "test_paths": ["tests/test_adversarial_reviewer.py"],
        "keywords": ["adversarial_reviewer"],
    },
    "n_of_3_with_escalation": {
        "module_paths": ["orchestrator/review_panel.py"],
        "test_paths": ["tests/test_review_panel.py"],
        "keywords": ["n_of_3", "disagreement_escalate"],
    },
}


# Test-oracle markers.
TEST_MARKERS = {
    "property_based": {
        "test_glob": "tests/test_*_properties.py",
        "min_modules": 3,
    },
    "mutation_testing": {
        "config_paths": [".mutmut-config", "mutmut_config.py",
                         "pyproject.toml"],  # mutmut config can live here
        "config_keywords": ["mutmut"],
        "kill_rate_file": "reports/mutmut-kill-rate.txt",
        "min_kill_rate": 0.80,
    },
    "live_sanity": {
        "script_paths": ["scripts/v5_live_sanity.sh"],
    },
    "golden_diff": {
        "fixture_paths": ["tests/golden/"],
    },
}


# Self-improvement markers.
SELF_IMPROVEMENT_MARKERS = {
    "propose_next_track_exists": "scripts/propose_next_track.py",
    "proposal_artifact_glob": "cycles/*/next-track-proposal.json",
    "ran_in_last_n_cycles": 5,
    "promotion_from_proposal_glob": "cycles/*/REPORT.md",
}


# --- Data classes ----------------------------------------------------------


@dataclass
class DimResult:
    dim: str
    level: int
    evidence: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


@dataclass
class LevelReport:
    by_dim: Dict[str, DimResult]
    overall: int

    def to_dict(self) -> dict:
        return {
            "by_dim": {k: asdict(v) for k, v in self.by_dim.items()},
            "overall": self.overall,
        }


# --- Helpers ---------------------------------------------------------------


def _read_text(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""


def _file_contains_any(path: Path, keywords: List[str]) -> bool:
    text = _read_text(path).lower()
    return any(kw.lower() in text for kw in keywords)


def _glob_files(root: Path, pattern: str) -> List[Path]:
    return sorted(root.glob(pattern))


def _count_failures_entries(failures_md: Path) -> int:
    text = _read_text(failures_md)
    return len(re.findall(r"^## FAIL-\d+", text, flags=re.MULTILINE))


def _count_adrs(adr_dir: Path) -> int:
    if not adr_dir.exists():
        return 0
    return len(list(adr_dir.glob("[0-9][0-9][0-9][0-9]-*.md")))


def _count_recent_cycles_with_artifact(cycles_dir: Path,
                                       artifact_name: str,
                                       n: int = 5) -> int:
    """Count how many of the last N cycle folders contain `artifact_name`."""
    if not cycles_dir.exists():
        return 0
    folders = sorted([p for p in cycles_dir.iterdir() if p.is_dir()],
                     reverse=True)[:n]
    return sum(1 for f in folders if (f / artifact_name).exists())


def _count_planner_refusals(cycles_dir: Path) -> int:
    """Count cycles whose PLAN.md cites a FAILURES.md hit and chose a
    different approach."""
    if not cycles_dir.exists():
        return 0
    n = 0
    for folder in cycles_dir.iterdir():
        if not folder.is_dir():
            continue
        plan = folder / "PLAN.md"
        if not plan.exists():
            continue
        text = _read_text(plan)
        # Cycle PLAN cites a FAIL- hit and explicitly chose another approach
        if re.search(r"FAIL-\d+.*(picked|chose|alternative|different approach)",
                     text, flags=re.IGNORECASE | re.DOTALL):
            n += 1
    return n


def _count_worktrees(repo_root: Path) -> int:
    """Count git worktrees (the main + any added). 1 = single-stream."""
    import subprocess
    try:
        out = subprocess.run(["git", "-C", str(repo_root),
                              "worktree", "list", "--porcelain"],
                             capture_output=True, text=True, check=True,
                             timeout=10)
        return out.stdout.count("worktree ")
    except Exception:  # noqa: BLE001
        return 1


def _gate_is_active(repo_root: Path, gate: dict) -> Tuple[bool, str]:
    """A gate is active if at least one module path exists AND at least
    one test path exists AND that test file references one of the keywords."""
    module_present = False
    for mp in gate.get("module_paths", []):
        if (repo_root / mp).exists():
            module_present = True
            break
    if not module_present:
        return False, "module missing"
    test_present = False
    for tp in gate.get("test_paths", []):
        tpath = repo_root / tp
        if tpath.exists() and _file_contains_any(tpath, gate.get("keywords", [])):
            test_present = True
            break
    if not test_present:
        return False, "regression test missing"
    return True, "module+test present"


# --- Dimension scorers -----------------------------------------------------


def memory_dim(repo_root: Path) -> DimResult:
    """M-dim: reports → CONTEXT+ADRs≥3 → FAILURES≥10 + grep-injected
    → clustering script → planner refusal x3."""
    ev: List[str] = []
    level = 3  # Baseline: reports exist (CHANGELOG.md serves)
    notes: List[str] = []

    # L3 evidence: a per-cycle CHANGELOG entry
    changelog = repo_root / "CHANGELOG.md"
    if changelog.exists() and _read_text(changelog).strip():
        ev.append("CHANGELOG.md present")
    else:
        notes.append("CHANGELOG.md missing or empty — L3 minimum not met")
        return DimResult("M", level=3, evidence=ev, notes=notes)

    # L4: CONTEXT.md + ADRs >= 3
    context = repo_root / "CONTEXT.md"
    adr_count = _count_adrs(repo_root / "docs" / "adr")
    if context.exists() and adr_count >= 3:
        level = 4
        ev.append(f"CONTEXT.md present + {adr_count} ADRs")

    # L5: FAILURES_entries >= 10 AND FAILURES.md grep step in PLAN
    failures = repo_root / "FAILURES.md"
    fail_count = _count_failures_entries(failures) if failures.exists() else 0
    if level >= 4 and fail_count >= 10:
        # Check that PLAN pre-flight step exists somewhere (preflight script
        # OR a documented PLAN template that includes the grep step)
        preflight_script = repo_root / "scripts" / "preflight_failures.py"
        if preflight_script.exists():
            level = 5
            ev.append(f"FAILURES.md has {fail_count} entries + preflight script wired")
        else:
            notes.append(
                f"FAILURES.md has {fail_count} entries but no preflight_failures.py — "
                "L5 needs both"
            )
    elif fail_count > 0:
        ev.append(f"FAILURES.md has {fail_count} entries (need 10 for L5)")

    # L6: failure clustering script runs green
    cluster_script = repo_root / "scripts" / "cluster_failures.py"
    cluster_report = repo_root / "reports" / "failure-clusters.md"
    if level >= 5 and cluster_script.exists() and cluster_report.exists():
        level = 6
        ev.append("Failure clustering script + report present")

    # L7: Planner refused 3+ times citing FAILURES
    refusals = _count_planner_refusals(repo_root / "cycles")
    if level >= 6 and refusals >= 3:
        level = 7
        ev.append(f"Planner refused {refusals} times citing FAILURES")

    return DimResult("M", level=level, evidence=ev, notes=notes)


def safety_dim(repo_root: Path) -> DimResult:
    """S-dim: per §9, level = min(7, 2 + gates_with_regression_tests).
    Capped below by 3 (baseline assumed for any working system)."""
    active_gates: List[str] = []
    inactive_notes: List[str] = []
    for gate in KNOWN_GATES:
        ok, reason = _gate_is_active(repo_root, gate)
        if ok:
            active_gates.append(gate["name"])
        else:
            inactive_notes.append(f"{gate['name']}: {reason}")
    n = len(active_gates)
    level = max(3, min(7, 2 + n))
    ev = [f"{n} active gates: {', '.join(active_gates) or 'none'}"]
    return DimResult("S", level=level, evidence=ev, notes=inactive_notes)


def review_dim(repo_root: Path) -> DimResult:
    """R-dim: single reviewer = L3; +codex = L5; +adversarial = L6;
    + N-of-3 with disagreement-escalation = L7."""
    ev: List[str] = []
    level = 3
    # Baseline single-model Reviewer
    reviewer_md = repo_root / "orchestrator" / "roles" / "reviewer.md"
    if reviewer_md.exists():
        ev.append("Single-model Reviewer present (orchestrator/roles/reviewer.md)")
    else:
        return DimResult("R", level=3, evidence=ev, notes=["reviewer.md missing"])

    # L5: codex bridge live
    if _gate_is_active(repo_root, REVIEW_MARKERS["codex_bridge"])[0]:
        level = 5
        ev.append("Codex cross-model bridge active")

    # L6: + adversarial reviewer
    if level >= 5 and _gate_is_active(repo_root,
                                      REVIEW_MARKERS["adversarial_reviewer"])[0]:
        level = 6
        ev.append("Adversarial Reviewer active")

    # L7: N-of-3 with disagreement-escalation
    if level >= 6 and _gate_is_active(repo_root,
                                      REVIEW_MARKERS["n_of_3_with_escalation"])[0]:
        level = 7
        ev.append("N-of-3 panel with disagreement-escalation active")

    return DimResult("R", level=level, evidence=ev)


def concurrency_dim(repo_root: Path) -> DimResult:
    """C-dim: single stream = L3; 2-3 worktrees + 30 cycles zero-deadlock = L5;
    5+ worktrees = L7."""
    n_worktrees = _count_worktrees(repo_root)
    ev = [f"{n_worktrees} git worktree(s) detected"]
    if n_worktrees <= 1:
        return DimResult("C", level=3, evidence=ev)
    # L4-L5 require zero-deadlock evidence; for now we only count the
    # presence of worktrees + a scheduler artifact.
    scheduler = repo_root / "orchestrator" / "scheduler.py"
    if not scheduler.exists():
        return DimResult("C", level=3, evidence=ev,
                         notes=["Worktrees present but no scheduler.py"])
    # zero-deadlock report
    zero_deadlock_report = repo_root / "reports" / "zero-deadlock-streak.txt"
    streak = 0
    if zero_deadlock_report.exists():
        try:
            streak = int(_read_text(zero_deadlock_report).strip() or "0")
        except ValueError:
            streak = 0
    if n_worktrees >= 2 and streak >= 30:
        ev.append(f"Zero-deadlock streak: {streak} cycles")
        if n_worktrees >= 5:
            return DimResult("C", level=7, evidence=ev)
        return DimResult("C", level=5, evidence=ev)
    if n_worktrees >= 2 and scheduler.exists():
        return DimResult("C", level=4, evidence=ev,
                         notes=[f"Need 30-cycle zero-deadlock streak (have {streak})"])
    return DimResult("C", level=3, evidence=ev)


def test_dim(repo_root: Path) -> DimResult:
    """T-dim: unit+replay=L3; +property≥3 modules=L4; +mutation≥80%=L5;
    +live sanity=L6; +golden-diff on all e2e=L7."""
    ev: List[str] = []
    notes: List[str] = []
    level = 3
    # L3: unit + replay tests
    tests_dir = repo_root / "tests"
    unit_tests = list(tests_dir.glob("test_*.py")) if tests_dir.exists() else []
    replay_test = tests_dir / "test_v4_e2e_replay.py"
    if not unit_tests:
        return DimResult("T", level=3, evidence=ev,
                         notes=["No tests/test_*.py found"])
    if replay_test.exists():
        ev.append(f"{len(unit_tests)} unit test files + e2e replay present")
    else:
        ev.append(f"{len(unit_tests)} unit test files (no replay)")

    # L4: property-based >=3 modules
    prop_tests = _glob_files(repo_root,
                             TEST_MARKERS["property_based"]["test_glob"])
    if len(prop_tests) >= TEST_MARKERS["property_based"]["min_modules"]:
        level = 4
        ev.append(f"{len(prop_tests)} property-based test files")
    elif prop_tests:
        # Show partial progress so future cycles can see how close T is to L4
        ev.append(f"{len(prop_tests)} of 3 property-based files for L4")
        notes.append(f"{len(prop_tests)} property-based files (need 3 for L4)")

    # L5: mutation testing kill-rate >= 80%
    kill_rate_file = (repo_root /
                      TEST_MARKERS["mutation_testing"]["kill_rate_file"])
    if level >= 4 and kill_rate_file.exists():
        try:
            rate = float(_read_text(kill_rate_file).strip())
            if rate >= TEST_MARKERS["mutation_testing"]["min_kill_rate"]:
                level = 5
                ev.append(f"Mutation kill rate {rate:.2%}")
        except ValueError:
            notes.append("mutmut-kill-rate.txt unparsable")

    # L6: live sanity script + at least one execution log
    live_script = repo_root / TEST_MARKERS["live_sanity"]["script_paths"][0]
    live_log_dir = repo_root / "reports" / "live-sanity"
    if level >= 5 and live_script.exists() and live_log_dir.exists():
        level = 6
        ev.append("Live sanity script + logs present")

    # L7: golden-diff fixtures present
    golden_dir = repo_root / TEST_MARKERS["golden_diff"]["fixture_paths"][0]
    if level >= 6 and golden_dir.exists():
        level = 7
        ev.append("Golden-diff fixtures present")

    return DimResult("T", level=level, evidence=ev, notes=notes)


def self_improvement_dim(repo_root: Path) -> DimResult:
    """E-dim: manual=L3; script exists=L4; ran last 5 cycles=L5; with
    FAILURES citations=L6; last 3 promotions from it=L7."""
    ev: List[str] = []
    level = 3
    script = repo_root / SELF_IMPROVEMENT_MARKERS["propose_next_track_exists"]
    if not script.exists():
        return DimResult("E", level=3, evidence=["Manual track-selection mode"])
    level = 4
    ev.append("propose_next_track.py exists")

    cycles_dir = repo_root / "cycles"
    ran = _count_recent_cycles_with_artifact(
        cycles_dir, "next-track-proposal.json",
        n=SELF_IMPROVEMENT_MARKERS["ran_in_last_n_cycles"])
    if ran >= SELF_IMPROVEMENT_MARKERS["ran_in_last_n_cycles"]:
        level = 5
        ev.append(f"Ran in last {ran} cycles")

    # L6: proposals cite FAILURES
    if level >= 5:
        recent = sorted([p for p in cycles_dir.iterdir() if p.is_dir()],
                        reverse=True)[:5]
        with_citations = 0
        for folder in recent:
            proposal = folder / "next-track-proposal.json"
            if not proposal.exists():
                continue
            text = _read_text(proposal)
            if "FAIL-" in text:
                with_citations += 1
        if with_citations >= 3:
            level = 6
            ev.append(f"{with_citations} proposals cite FAILURES")

    # L7: last 3 level-up promotions came from the proposal
    if level >= 6:
        # Look in CHANGELOG.md for level-up entries (🎯 marker) and check
        # whether the corresponding cycle's REPORT.md cites the proposal.
        changelog = repo_root / "CHANGELOG.md"
        promotions_from_proposal = 0
        if changelog.exists():
            for line in _read_text(changelog).splitlines():
                if "🎯" not in line:
                    continue
                m = re.match(r"(\d{8}-\d{6})", line.strip())
                if not m:
                    continue
                cycle_id = m.group(1)
                report = cycles_dir / cycle_id / "REPORT.md"
                if report.exists() and "next-track-proposal" in _read_text(report):
                    promotions_from_proposal += 1
        if promotions_from_proposal >= 3:
            level = 7
            ev.append(f"{promotions_from_proposal} recent promotions cite proposal")

    return DimResult("E", level=level, evidence=ev)


def compute_levels(repo_root: Path) -> LevelReport:
    repo_root = Path(repo_root).resolve()
    by_dim = {
        "M": memory_dim(repo_root),
        "S": safety_dim(repo_root),
        "R": review_dim(repo_root),
        "C": concurrency_dim(repo_root),
        "T": test_dim(repo_root),
        "E": self_improvement_dim(repo_root),
    }
    overall = min(d.level for d in by_dim.values())
    return LevelReport(by_dim=by_dim, overall=overall)


# --- I/O -------------------------------------------------------------------


def render_level_md(report: LevelReport) -> str:
    """Render LEVEL.md content. Generated only — never hand-edited."""
    lines = [
        "# LEVEL.md (generated by scripts/compute_level.py — DO NOT HAND-EDIT)",
        "",
        "Per §3 + §9 of AUTODEV_L7_MASTER_PROMPT.md.",
        "Overall L = min across all dimensions.",
        "",
    ]
    for dim in DIMS:
        result = report.by_dim[dim]
        ev_summary = "; ".join(result.evidence) if result.evidence else "(none)"
        lines.append(f"{dim} {result.level} | evidence: {ev_summary}")
        for note in result.notes:
            lines.append(f"  - note: {note}")
    lines.append("")
    lines.append(f"Overall L = {report.overall}")
    lines.append("")
    return "\n".join(lines)


def parse_level_md(path: Path) -> Dict[str, int]:
    """Parse LEVEL.md back into {dim: level} for --check mode."""
    parsed: Dict[str, int] = {}
    if not path.exists():
        return parsed
    text = _read_text(path)
    for line in text.splitlines():
        m = re.match(r"^([MSRCTE])\s+(\d+)\s*\|", line)
        if m:
            parsed[m.group(1)] = int(m.group(2))
    return parsed


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="L7 rubric scorer")
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if any dim regressed vs LEVEL.md")
    parser.add_argument("--json", action="store_true",
                        help="print machine-readable JSON to stdout")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="print evidence per dimension")
    parser.add_argument("--repo-root",
                        default=str(Path(__file__).resolve().parent.parent),
                        help="repo root (default: parent of scripts/)")
    parser.add_argument("--output", default="LEVEL.md",
                        help="output path (default: LEVEL.md at repo root)")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve()
    report = compute_levels(repo_root)

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
        return 0

    output_path = (repo_root / args.output) if not Path(args.output).is_absolute() \
        else Path(args.output)

    if args.check:
        existing = parse_level_md(output_path)
        regressions: List[str] = []
        for dim in DIMS:
            new = report.by_dim[dim].level
            old = existing.get(dim, new)
            if new < old:
                regressions.append(f"{dim}: {old} → {new}")
        if regressions:
            print(f"[compute_level] REGRESSION: {', '.join(regressions)}",
                  file=sys.stderr)
            return 1
        if args.verbose:
            print(render_level_md(report))
        else:
            print(f"[compute_level] check passed (overall L={report.overall})")
        return 0

    # Write mode
    content = render_level_md(report)
    output_path.write_text(content)
    if args.verbose:
        print(content)
    else:
        print(f"[compute_level] wrote {output_path} (overall L={report.overall})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
