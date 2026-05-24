"""Task lifecycle + task_events log.

A task is the unit of work in the system: one repo, one goal, walks through
a state machine from ``queued`` → ... → ``merged`` (or ``failed`` / ``stuck``
/ ``cancelled``). Every status change is recorded as a ``task_events`` row
so the timeline view in the dashboard can reconstruct what happened.

The state machine is enforced by ``TaskStatus.allowed_transitions``; callers
that attempt an illegal transition get ``InvalidTransitionError``. This is
deliberate — the orchestrator wires roles to specific transitions, and we
catch bugs by failing loudly rather than silently corrupting state.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator.ids import make_id, utc_now_iso


class TaskStatus(str, Enum):
    queued = "queued"
    planning = "planning"
    coding = "coding"
    testing = "testing"
    reviewing = "reviewing"
    validating = "validating"
    pr_created = "pr_created"
    waiting_for_approval = "waiting_for_approval"
    auto_merging = "auto_merging"
    merged = "merged"
    stuck = "stuck"
    failed = "failed"
    paused = "paused"
    cancelled = "cancelled"

    @classmethod
    def terminal(cls) -> set["TaskStatus"]:
        return {cls.merged, cls.failed, cls.cancelled}


# Adjacency list. ``TaskStatus.x`` -> set of next states allowed.
# pause/resume/cancel/stuck/fail are reachable from almost anywhere; we
# enumerate explicitly to make audits possible.
ALLOWED_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.queued: {TaskStatus.planning, TaskStatus.paused, TaskStatus.cancelled},
    TaskStatus.planning: {TaskStatus.coding, TaskStatus.stuck, TaskStatus.failed,
                          TaskStatus.paused, TaskStatus.cancelled},
    TaskStatus.coding: {TaskStatus.testing, TaskStatus.stuck, TaskStatus.failed,
                        TaskStatus.paused, TaskStatus.cancelled},
    TaskStatus.testing: {TaskStatus.reviewing, TaskStatus.coding,  # repair loop
                         TaskStatus.stuck, TaskStatus.failed,
                         TaskStatus.paused, TaskStatus.cancelled},
    TaskStatus.reviewing: {TaskStatus.validating, TaskStatus.coding,  # repair loop
                           TaskStatus.stuck, TaskStatus.failed,
                           TaskStatus.paused, TaskStatus.cancelled},
    TaskStatus.validating: {TaskStatus.pr_created, TaskStatus.coding,
                            TaskStatus.stuck, TaskStatus.failed,
                            TaskStatus.paused, TaskStatus.cancelled},
    TaskStatus.pr_created: {TaskStatus.auto_merging, TaskStatus.waiting_for_approval,
                            TaskStatus.failed, TaskStatus.cancelled, TaskStatus.paused},
    TaskStatus.waiting_for_approval: {TaskStatus.auto_merging, TaskStatus.failed,
                                      TaskStatus.cancelled, TaskStatus.paused},
    TaskStatus.auto_merging: {TaskStatus.merged, TaskStatus.failed, TaskStatus.stuck},
    TaskStatus.paused: {TaskStatus.queued, TaskStatus.planning, TaskStatus.coding,
                        TaskStatus.testing, TaskStatus.reviewing, TaskStatus.validating,
                        TaskStatus.pr_created, TaskStatus.waiting_for_approval,
                        TaskStatus.cancelled},
    TaskStatus.stuck: {TaskStatus.coding, TaskStatus.planning, TaskStatus.cancelled,
                       TaskStatus.failed},
    TaskStatus.merged: set(),
    TaskStatus.failed: set(),
    TaskStatus.cancelled: set(),
}


class InvalidTransitionError(ValueError):
    pass


def _validate_transition(cur: str, nxt: str) -> None:
    try:
        cur_e = TaskStatus(cur)
        nxt_e = TaskStatus(nxt)
    except ValueError as e:
        raise InvalidTransitionError(str(e)) from e
    if nxt_e not in ALLOWED_TRANSITIONS[cur_e]:
        raise InvalidTransitionError(f"{cur} -> {nxt} not allowed")


@dataclass(frozen=True)
class Task:
    id: str
    repo_id: str
    goal: str
    source: str
    source_ref: str | None
    status: str
    branch: str | None
    pr_number: int | None
    risk_score: int | None
    created_at: str
    updated_at: str
    finished_at: str | None
    payload: dict[str, Any]


def _row_to_task(row) -> Task:  # row is sqlite3.Row
    return Task(
        id=row["id"],
        repo_id=row["repo_id"],
        goal=row["goal"],
        source=row["source"],
        source_ref=row["source_ref"],
        status=row["status"],
        branch=row["branch"],
        pr_number=row["pr_number"],
        risk_score=row["risk_score"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        finished_at=row["finished_at"],
        payload=json.loads(row["payload_json"] or "{}"),
    )


def create_task(
    repo_id: str,
    goal: str,
    source: str = "cli",
    source_ref: str | None = None,
    payload: dict[str, Any] | None = None,
    db_path: Path | str | None = None,
) -> Task:
    """Insert a new task in status=queued. Records a ``created`` event."""
    if not repo_id:
        raise ValueError("repo_id required")
    if not goal or not goal.strip():
        raise ValueError("goal required")
    now = utc_now_iso()
    tid = make_id("task")
    with open_db(db_path) as conn:
        # repo must exist
        row = conn.execute("SELECT id FROM repos WHERE id = ?", (repo_id,)).fetchone()
        if row is None:
            raise ValueError(f"unknown repo_id {repo_id!r}")
        conn.execute(
            """
            INSERT INTO tasks (id, repo_id, goal, source, source_ref, status,
                               created_at, updated_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (tid, repo_id, goal, source, source_ref, TaskStatus.queued.value,
             now, now, json.dumps(payload or {})),
        )
        _emit_event(conn, tid, "created", f"task created from {source}", payload or {})
        return _fetch(conn, tid)


def transition(
    task_id: str,
    new_status: str | TaskStatus,
    *,
    message: str | None = None,
    payload: dict[str, Any] | None = None,
    db_path: Path | str | None = None,
    branch: str | None = None,
    pr_number: int | None = None,
    risk_score: int | None = None,
) -> Task:
    """Move a task to ``new_status``. Records an event of the same type."""
    new = new_status.value if isinstance(new_status, TaskStatus) else str(new_status)
    now = utc_now_iso()
    with open_db(db_path) as conn:
        cur = conn.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if cur is None:
            raise ValueError(f"unknown task {task_id!r}")
        _validate_transition(cur["status"], new)
        sets = ["status = ?", "updated_at = ?"]
        args: list[Any] = [new, now]
        if branch is not None:
            sets.append("branch = ?")
            args.append(branch)
        if pr_number is not None:
            sets.append("pr_number = ?")
            args.append(pr_number)
        if risk_score is not None:
            sets.append("risk_score = ?")
            args.append(risk_score)
        if TaskStatus(new) in TaskStatus.terminal():
            sets.append("finished_at = ?")
            args.append(now)
        args.append(task_id)
        conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", args)
        _emit_event(conn, task_id, new, message or f"transition -> {new}", payload or {})
        return _fetch(conn, task_id)


def list_tasks(
    *,
    repo_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
    db_path: Path | str | None = None,
) -> list[Task]:
    where: list[str] = []
    args: list[Any] = []
    if repo_id:
        where.append("repo_id = ?")
        args.append(repo_id)
    if status:
        where.append("status = ?")
        args.append(status)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with open_db(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM tasks {clause} ORDER BY created_at DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
        return [_row_to_task(r) for r in rows]


def get_task(task_id: str, db_path: Path | str | None = None) -> Task | None:
    with open_db(db_path) as conn:
        return _fetch(conn, task_id, optional=True)


def get_timeline(task_id: str, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Return the ordered task_events for a task.

    Ordering is (created_at ASC, rowid ASC). Using rowid as the tiebreaker —
    not id — is deliberate: within a single millisecond multiple events can
    share created_at, and ULID ids only sort monotonically by their timestamp
    portion, so the random suffix can reverse the *insertion* order.
    """
    with open_db(db_path) as conn:
        rows = conn.execute(
            "SELECT id, created_at, event_type, message, payload_json FROM task_events "
            "WHERE task_id = ? ORDER BY created_at ASC, rowid ASC",
            (task_id,),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "created_at": r["created_at"],
                "event_type": r["event_type"],
                "message": r["message"],
                "payload": json.loads(r["payload_json"] or "{}"),
            }
            for r in rows
        ]


# ────────────────────────────────────────────────────────────────────────


def _fetch(conn, task_id: str, *, optional: bool = False) -> Task | None:
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        if optional:
            return None
        raise ValueError(f"task {task_id} disappeared")
    return _row_to_task(row)


def _emit_event(conn, task_id: str, event_type: str, message: str, payload: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO task_events (id, task_id, created_at, event_type, message, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (make_id("evt"), task_id, utc_now_iso(), event_type, message, json.dumps(payload)),
    )
