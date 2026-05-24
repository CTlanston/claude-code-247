"""Forbidden-path enforcement.

Two angles:

  * ``violations_in_diff`` — list of files that match the repo's
    forbidden_paths globs, used by merge_policy as a hard block.
  * ``violations_in_workspace`` — for a checked-out workspace, list
    any forbidden-pattern files that were modified relative to the
    base branch.
"""
from __future__ import annotations

import fnmatch
from typing import Iterable


def matches_any(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, p) for p in patterns)


def violations_in_diff(files: Iterable[str], *,
                       forbidden_paths: Iterable[str]) -> list[str]:
    forbidden = list(forbidden_paths)
    return [f for f in files if matches_any(f, forbidden)]


def violations_in_workspace(workspace: str | "os.PathLike[str]", *,
                            forbidden_paths: Iterable[str],
                            base_branch: str = "main") -> list[str]:
    import os
    import subprocess
    ws = os.fspath(workspace)
    try:
        out = subprocess.check_output(
            ["git", "-C", ws, "diff", "--name-only", base_branch],
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return []
    files = [ln for ln in out.splitlines() if ln.strip()]
    return violations_in_diff(files, forbidden_paths=forbidden_paths)
