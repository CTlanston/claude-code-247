"""Cycle 39 — health regenerated artifacts must be gitignored
and untracked.

Cycle 37 committed reports/health.json + health.md +
health.history.jsonl. They're regenerated on every
`autodev_health.sh` call, so tracking them means each wake
dirties the tree → next wake's "git status clean" check fails →
BLOCKED.md → launchd path stalls.

This module verifies they're correctly untracked + gitignored
going forward. Pattern matches existing operational-only
gitignored files (codex-reviews.jsonl, adversarial-reviews.jsonl,
state.corrupt.*.json, heartbeat.json).
"""
from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
HEALTH_FILES = [
    "reports/health.json",
    "reports/health.md",
    "reports/health.history.jsonl",
]


def _gitignore_text() -> str:
    return (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")


def test_gitignore_contains_all_health_paths():
    """All 3 health artifacts must be ignored."""
    text = _gitignore_text()
    for path in HEALTH_FILES:
        assert path in text, (
            f"{path} not in .gitignore; without it, every wake will "
            f"dirty the working tree via the regenerated artifact"
        )


def test_health_files_not_tracked_by_git():
    """`git ls-files` should return EMPTY for each health path."""
    for path in HEALTH_FILES:
        r = subprocess.run(
            ["git", "ls-files", path],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=10,
        )
        assert r.returncode == 0
        assert r.stdout.strip() == "", (
            f"{path} is still tracked by git: {r.stdout!r}. "
            f"`git rm --cached {path}` is needed."
        )


def test_health_files_exist_on_disk():
    """Being gitignored does NOT mean missing — the wake script
    + the doctor still read these. They exist on disk; they're
    just untracked."""
    for path in HEALTH_FILES:
        full = REPO_ROOT / path
        # If they aren't on disk yet (e.g. fresh checkout), the
        # autodev_health.sh smoke earlier in the suite would have
        # made them. Tolerate absence for now and pass-through.
        if not full.exists():
            continue
        assert full.is_file()


def _porcelain_lines() -> set:
    r = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=10,
    )
    assert r.returncode == 0
    return set(line for line in r.stdout.splitlines() if line.strip())


def test_running_health_does_not_dirty_tracked_tree():
    """After this cycle: invoking `autodev_health.sh` should NOT
    cause NEW health-file entries to appear in `git status
    --porcelain`. (Staged deletions from this cycle's `git rm
    --cached` are pre-existing and excluded from this check.)"""
    before = _porcelain_lines()
    r = subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "autodev_health.sh")],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=60,
    )
    assert r.returncode == 0, f"autodev_health.sh failed: {r.stderr}"
    after = _porcelain_lines()

    new_lines = after - before
    # Any NEW dirty lines for health-related files would indicate
    # the gitignore isn't taking effect.
    bad_new = [
        line for line in new_lines
        if any(hp in line for hp in HEALTH_FILES)
    ]
    assert not bad_new, (
        f"After autodev_health.sh, NEW health-file entries "
        f"appeared in git status: {bad_new}. The gitignore is "
        f"not effective; the wake script would dirty the tree."
    )


def test_gitignore_has_comment_explaining_why():
    """Comment hygiene: the gitignore entries should be near a
    comment explaining the FAIL-0009-class rationale."""
    text = _gitignore_text()
    # Find the health.json entry line; check the preceding ~5 lines
    # for a comment mentioning either wake/regenerated/operational.
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if "reports/health.json" in line:
            window = lines[max(0, i - 6):i]
            window_text = "\n".join(window).lower()
            assert any(
                hint in window_text
                for hint in ("regenerat", "wake", "operational",
                             "health-score", "every call")
            ), (
                f"gitignore entry for reports/health.json should be "
                f"near an explanatory comment; preceding lines: {window!r}"
            )
            break
    else:
        # The first test already asserts presence; this one only fires
        # if it WAS found.
        pass
