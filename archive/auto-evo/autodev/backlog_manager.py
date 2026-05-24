"""BacklogManager — parse `tasks/backlog.md` and pick the next unblocked task.

Backlog format (canonical):

    # Backlog
    ## P0
    - [ ] TASK-001: short title :: details
    - [.] TASK-002: in progress :: ...
    - [x] TASK-003: done :: ...
    - [!] TASK-004: blocked :: ...

Selection rule:
  1. Iterate priorities P0 → P1 → P2 → ...
  2. Within a priority, take the first `- [ ]` task.
  3. If found, move it to `tasks/current.md` and mark it `- [.]` in the
     backlog so we don't re-select it on the next cycle.
  4. If no `- [ ]` task exists at any priority, return None.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Relaxed regex: any "[ ]" / "[x]" / "[.]" / "[!]" task with priority context.
_TASK_LINE_RE = re.compile(
    r"^\s*-\s*\[(?P<status>[ x.!])\]\s*(?P<id>[A-Z][A-Z0-9_-]+-\d+):\s*"
    r"(?P<title>[^:][^\n]*?)(?:\s*::\s*(?P<details>.*))?$"
)
_PRIORITY_HEADER_RE = re.compile(r"^\s*##\s+(?P<prio>P\d+)\s*$")


@dataclass
class BacklogTask:
    task_id: str
    title: str
    details: str
    priority: str
    status: str  # one of: " ", "x", ".", "!"

    def status_label(self) -> str:
        return {" ": "queued", "x": "done", ".": "in_progress", "!": "blocked"}.get(
            self.status, "unknown"
        )


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def backlog_path() -> Path:
    return _project_root() / "tasks" / "backlog.md"


def current_path() -> Path:
    return _project_root() / "tasks" / "current.md"


def done_path() -> Path:
    return _project_root() / "tasks" / "done.md"


def blockers_path() -> Path:
    return _project_root() / "tasks" / "blockers.md"


class BacklogManager:
    def __init__(self, backlog_file: Optional[Path] = None):
        self._backlog = Path(backlog_file) if backlog_file else backlog_path()

    # ----- parse ----------------------------------------------------------

    def parse(self) -> list[BacklogTask]:
        if not self._backlog.exists():
            return []
        tasks: list[BacklogTask] = []
        current_prio = "P9"  # tasks above any P0 header default to P9 (lowest)
        for line in self._backlog.read_text().splitlines():
            mh = _PRIORITY_HEADER_RE.match(line)
            if mh:
                current_prio = mh.group("prio")
                continue
            mt = _TASK_LINE_RE.match(line)
            if mt:
                tasks.append(
                    BacklogTask(
                        task_id=mt.group("id"),
                        title=mt.group("title").strip(),
                        details=(mt.group("details") or "").strip(),
                        priority=current_prio,
                        status=mt.group("status"),
                    )
                )
        return tasks

    # ----- queries --------------------------------------------------------

    def next_unblocked(self) -> Optional[BacklogTask]:
        """First queued task in priority order. None if backlog empty."""
        tasks = self.parse()
        # Sort by priority number (P0 first); stable wrt source order.
        def prio_key(t: BacklogTask) -> int:
            try:
                return int(t.priority[1:])
            except (ValueError, IndexError):
                return 99
        for t in sorted(tasks, key=prio_key):
            if t.status == " ":
                return t
        return None

    def has_in_progress(self) -> Optional[BacklogTask]:
        for t in self.parse():
            if t.status == ".":
                return t
        return None

    # ----- transitions ----------------------------------------------------

    def mark_in_progress(self, task_id: str) -> bool:
        return self._set_status(task_id, " ", ".")

    def mark_done(self, task_id: str) -> bool:
        ok = self._set_status(task_id, ".", "x") or self._set_status(task_id, " ", "x")
        if ok:
            self._archive_done(task_id)
        return ok

    def mark_blocked(self, task_id: str, reason: str = "") -> bool:
        ok = self._set_status(task_id, ".", "!") or self._set_status(task_id, " ", "!")
        if ok:
            self._record_blocker(task_id, reason)
        return ok

    def _set_status(self, task_id: str, want_from: str, want_to: str) -> bool:
        if not self._backlog.exists():
            return False
        lines = self._backlog.read_text().splitlines()
        changed = False
        out = []
        for line in lines:
            m = _TASK_LINE_RE.match(line)
            if m and m.group("id") == task_id and m.group("status") == want_from:
                new = line.replace(f"[{want_from}]", f"[{want_to}]", 1)
                out.append(new)
                changed = True
            else:
                out.append(line)
        if changed:
            self._backlog.write_text("\n".join(out) + ("\n" if lines and not lines[-1] == "" else ""))
        return changed

    def _archive_done(self, task_id: str) -> None:
        d = done_path()
        d.parent.mkdir(parents=True, exist_ok=True)
        prefix = f"\n- [x] {task_id}: completed at " + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with d.open("a") as f:
            f.write(prefix)

    def _record_blocker(self, task_id: str, reason: str) -> None:
        b = blockers_path()
        b.parent.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with b.open("a") as f:
            f.write(f"\n- {ts}  {task_id}: {reason or 'no reason given'}")

    # ----- current task pointer ------------------------------------------

    def write_current(self, task: BacklogTask) -> None:
        cur = current_path()
        cur.parent.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        cur.write_text(
            f"# Current task\n\n"
            f"- ID: {task.task_id}\n"
            f"- Priority: {task.priority}\n"
            f"- Title: {task.title}\n"
            f"- Details: {task.details}\n"
            f"- Picked up at: {ts}\n"
        )

    def clear_current(self) -> None:
        current_path().write_text("# Current task\n\nNo task in progress.\n")
