"""scheduler — Track C2-init skeleton + Track C3 dispatch (Cycle 20).

Discovers git worktrees, picks idle ones, dispatches tasks across
streams, and tracks the zero-deadlock streak that C-L5 requires.

Cycle 17 added: Worktree, Scheduler.next_idle_worktree, discover_worktrees,
_parse_worktree_porcelain. Cycle 20 adds: Task, Scheduler.dispatch_next,
Scheduler.record_cycle_success, Scheduler.current_zero_deadlock_streak.

Multi-stream live dispatch is still a future cycle (Track C4+); this
module is the structural foundation that compute_level's C-dim L4-L5
checks require.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STREAK_FILE = REPO_ROOT / "reports" / "zero-deadlock-streak.txt"
DEFAULT_HISTORY_FILE = REPO_ROOT / "reports" / "cycle-history.jsonl"


@dataclass
class Worktree:
    """Single git worktree entry from `git worktree list --porcelain`."""
    path: Path
    branch: Optional[str] = None
    head_sha: Optional[str] = None
    detached: bool = False
    bare: bool = False


@dataclass
class Task:
    """Task awaiting dispatch. Track C3.

    L7 priority convention: smaller value = higher urgency (P0 < P1).
    `blocked=True` skips the task entirely.
    """
    id: str
    priority: int = 100
    blocked: bool = False
    payload: Optional[object] = None


@dataclass
class Scheduler:
    """Multi-worktree dispatch scheduler."""
    worktrees: List[Worktree] = field(default_factory=list)
    tasks: List[Task] = field(default_factory=list)
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

    # -------------------------------------------------------------------
    # Track C3 additions (Cycle 20)
    # -------------------------------------------------------------------

    def dispatch_next(self) -> Optional[Tuple[Worktree, Task]]:
        """Pick the lowest-priority unblocked Task and pair it with an
        idle worktree. Returns (worktree, task) or None if nothing
        can be dispatched right now.

        Does NOT actually start the task — the caller is responsible
        for creating the in-progress marker + invoking the actual work.
        This separation keeps `dispatch_next` pure and easy to test."""
        if not self.tasks:
            return None
        unblocked = sorted(
            (t for t in self.tasks if not t.blocked),
            key=lambda t: (t.priority, t.id),
        )
        if not unblocked:
            return None
        idle = self.next_idle_worktree()
        if idle is None:
            return None
        return (idle, unblocked[0])

    def current_zero_deadlock_streak(self) -> int:
        """Read the streak counter file. Returns 0 if missing or malformed."""
        path = self._streak_file()
        if not path.exists():
            return 0
        try:
            return int(path.read_text().strip() or "0")
        except (ValueError, OSError):
            return 0

    def record_cycle_success(self, cycle_id: str, *,
                              deadlock: bool = False) -> None:
        """Append a cycle-history entry; bump the streak on success,
        reset to 0 on deadlock.

        A "deadlock" here is the operator's call (or a future automated
        detector's call) when two streams are waiting on each other or
        cycle progress halts. For now, this is a manually-driven
        counter; future cycles can wire automatic deadlock detection in."""
        streak_path = self._streak_file()
        history_path = self._history_file()
        streak_path.parent.mkdir(parents=True, exist_ok=True)
        history_path.parent.mkdir(parents=True, exist_ok=True)

        if deadlock:
            new_streak = 0
        else:
            new_streak = self.current_zero_deadlock_streak() + 1
        streak_path.write_text(f"{new_streak}\n")

        entry = {
            "cycle_id": cycle_id,
            "ts": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
            "deadlock": bool(deadlock),
            "streak_after": new_streak,
        }
        with history_path.open("a") as f:
            f.write(json.dumps(entry) + "\n")

    def _streak_file(self) -> Path:
        return self.repo_root / "reports" / "zero-deadlock-streak.txt"

    def _history_file(self) -> Path:
        return self.repo_root / "reports" / "cycle-history.jsonl"


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
