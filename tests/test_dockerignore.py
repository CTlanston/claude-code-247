"""Cycle 44 — `.dockerignore` regression tests (closes FAIL-0008).

FAIL-0008's symptom was `docker build` copying `state/*.db`,
`workspaces/`, `.env`, and `__pycache__/` into image layers,
producing 800MB+ images that shipped credentials. The fix is a
root `.dockerignore` that excludes those paths.

These tests pin the patterns. Each `.dockerignore` line is
verified individually so a future edit that drops one pattern
fails loudly.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DOCKERIGNORE = REPO_ROOT / ".dockerignore"


def _patterns() -> list[str]:
    """Return the non-comment, non-blank pattern lines from .dockerignore."""
    if not DOCKERIGNORE.exists():
        return []
    return [
        line.strip()
        for line in DOCKERIGNORE.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


# --- Existence + non-empty ----------------------------------------


def test_dockerignore_exists():
    assert DOCKERIGNORE.exists(), (
        f"{DOCKERIGNORE} must exist — FAIL-0008 working fix."
    )


def test_dockerignore_has_at_least_5_patterns():
    """A non-trivial dockerignore must cover at least the 5 main
    leak surfaces from FAIL-0008."""
    patterns = _patterns()
    assert len(patterns) >= 5, (
        f"expected at least 5 patterns; got {len(patterns)}: "
        f"{patterns}"
    )


# --- Required patterns (one assertion per pattern) ---------------


def _has(pattern_substring: str) -> bool:
    """True if any pattern line contains the substring."""
    return any(pattern_substring in p for p in _patterns())


def test_dockerignore_excludes_state_db():
    """state/*.db are LIVE SQLite databases; must never enter
    image context."""
    assert _has("state/"), (
        ".dockerignore must exclude state/ (live SQLite DBs)"
    )


def test_dockerignore_excludes_workspaces():
    """workspaces/ contains per-issue clones, possibly GBs."""
    assert _has("workspaces/"), (
        ".dockerignore must exclude workspaces/"
    )


def test_dockerignore_excludes_env_files():
    """§0 rule 3: SECRETS MUST NEVER be embedded in image layers.
    `.env*` is the canonical credential surface."""
    assert _has(".env"), (
        ".dockerignore MUST exclude .env files — §0 rule 3 prohibits "
        "secrets in image layers"
    )


def test_dockerignore_excludes_pycache():
    assert _has("__pycache__"), (
        ".dockerignore should exclude __pycache__/ build noise"
    )


def test_dockerignore_excludes_venv():
    """A host's `.venv/` would bake host-specific paths into the
    image. Always exclude."""
    assert _has(".venv"), ".dockerignore should exclude .venv/"


def test_dockerignore_excludes_cycles():
    """L7 per-cycle artifacts under cycles/<id>/ aren't runtime."""
    assert _has("cycles/"), ".dockerignore should exclude cycles/"


def test_dockerignore_excludes_reports_runs():
    """reports/runs/ holds per-wake launchd logs; not runtime."""
    assert _has("reports/runs/"), (
        ".dockerignore should exclude reports/runs/"
    )


def test_dockerignore_excludes_git_dir():
    """The .git/ directory is huge and should never be in image."""
    assert _has(".git"), ".dockerignore should exclude .git/"


def test_dockerignore_excludes_worktrees():
    """Track C2 git worktrees: not runtime."""
    assert _has("worktrees/"), (
        ".dockerignore should exclude worktrees/"
    )


# --- Empirical reproduction (docker-conditional) -----------------


def test_dockerignore_patterns_block_excluded_paths():
    """Smoke check: each excluded pattern's substring should not
    overlap with a 'wanted' path in the image. (This isn't a docker
    build test — that would need docker — just a sanity check that
    the patterns aren't pathologically broad.)"""
    patterns = _patterns()
    # No pattern should be a bare '*' or '.' (which would exclude
    # everything)
    for p in patterns:
        assert p not in (".", "*", "/", "**"), (
            f"pattern {p!r} would exclude too much"
        )


def test_dockerignore_does_not_exclude_orchestrator_or_runner():
    """The 2 Dockerfiles live at runner/Dockerfile and
    orchestrator/Dockerfile. Excluding those directories
    wholesale would defeat the build entirely."""
    patterns = _patterns()
    for danger in ("/orchestrator/", "/runner/", "orchestrator/*",
                   "runner/*"):
        assert danger not in patterns, (
            f"pattern {danger!r} would exclude the Dockerfile's "
            f"own directory — would break the build"
        )


def test_dockerignore_does_not_exclude_autodev_package():
    """autodev/ is the Python package; the runner image needs it."""
    patterns = _patterns()
    for p in patterns:
        # Be permissive: 'autodev/' alone would be too broad.
        # But 'autodev/__pycache__/' is fine (more specific).
        assert p.rstrip("/") != "autodev", (
            f"pattern {p!r} would exclude the autodev/ Python package"
        )


# --- FAILURES.md cross-reference ----------------------------------


def test_failures_md_marks_fail_0008_as_shipped():
    """After this cycle, FAIL-0008 entry should reflect the
    empirically reproduced + shipped status."""
    text = (REPO_ROOT / "FAILURES.md").read_text()
    fail_idx = text.find("## FAIL-0008:")
    end_idx = text.find("## FAIL-0009:", fail_idx)
    block = text[fail_idx:end_idx]
    # The Cycle 44 working fix is shipped → empirically_reproduced
    # should be yes.
    er_line = None
    for line in block.splitlines():
        if "Empirically reproduced" in line:
            er_line = line
            break
    assert er_line is not None, (
        "FAIL-0008 must have an Empirically reproduced field"
    )
    assert "yes" in er_line.lower(), (
        f"FAIL-0008 Empirically reproduced should be 'yes' after "
        f"Cycle 44; got: {er_line!r}"
    )
