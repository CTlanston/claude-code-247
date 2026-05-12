"""scheduler — Track C2-init skeleton (Cycle 17).

Discovers git worktrees + picks the next idle one for dispatch. The
actual cross-worktree dispatch logic + STATE.md merge lives in Track
C3 (next cycle). This module is the structural foundation that
compute_level's C-dim L4 check requires.

The scheduler is intentionally minimal — it does NOT yet run anything,
DOES NOT manage queues, and DOES NOT communicate across worktrees.
It only knows: which worktrees exist, and which is "next" by a stable
order.

Future Track C3 will add:
- in-flight markers (cycles/<id>/in-progress on each worktree)
- collision detection (two streams writing the same module)
- per-stream state DB shards
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Worktree:
    """Single git worktree entry from `git worktree list --porcelain`."""
    path: Path
    branch: Optional[str] = None
    head_sha: Optional[str] = None
    detached: bool = False
    bare: bool = False


@dataclass
class Scheduler:
    """Multi-worktree dispatch scheduler (skeleton for Track C2-init)."""
    worktrees: List[Worktree] = field(default_factory=list)
    repo_root: Path = REPO_ROOT

    def refresh(self) -> None:
        """Re-discover worktrees from git."""
        self.worktrees = discover_worktrees(self.repo_root)

    def next_idle_worktree(self) -> Optional[Worktree]:
        """Return the first worktree that has no `in-progress` marker.

        Track C3 will refine this with real marker files; for the
        C2-init skeleton we just return the first non-primary worktree.
        """
        if not self.worktrees:
            self.refresh()
        # Skip the primary (the one whose path == repo_root)
        for wt in self.worktrees:
            if wt.path.resolve() == self.repo_root.resolve():
                continue
            # Stub for idle check: no in-progress file at wt.path
            if not (wt.path / ".in-progress").exists():
                return wt
        return None


def discover_worktrees(repo_root: Path = REPO_ROOT) -> List[Worktree]:
    """Parse `git worktree list --porcelain` into a list of Worktree."""
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_root), "worktree", "list", "--porcelain"],
            capture_output=True, text=True, check=True, timeout=10,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            FileNotFoundError):
        return []
    return _parse_worktree_porcelain(out.stdout)


def _parse_worktree_porcelain(text: str) -> List[Worktree]:
    """Each worktree block looks like:

        worktree /path/to/wt
        HEAD abc1234...
        branch refs/heads/foo

        worktree /next
        HEAD def5678...
        detached

    Blocks are separated by blank lines.
    """
    out: List[Worktree] = []
    current: Optional[dict] = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line:
            if current and current.get("path"):
                out.append(_finalise(current))
            current = None
            continue
        if current is None:
            current = {}
        if line.startswith("worktree "):
            current["path"] = line.split(" ", 1)[1]
        elif line.startswith("HEAD "):
            current["head_sha"] = line.split(" ", 1)[1]
        elif line.startswith("branch "):
            current["branch"] = line.split(" ", 1)[1].replace("refs/heads/", "")
        elif line == "detached":
            current["detached"] = True
        elif line == "bare":
            current["bare"] = True
    if current and current.get("path"):
        out.append(_finalise(current))
    return out


def _finalise(d: dict) -> Worktree:
    return Worktree(
        path=Path(d["path"]),
        branch=d.get("branch"),
        head_sha=d.get("head_sha"),
        detached=bool(d.get("detached", False)),
        bare=bool(d.get("bare", False)),
    )
