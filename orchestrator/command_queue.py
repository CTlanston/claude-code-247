"""Command queue.

Every action from CLI / dashboard / remote dispatch goes through here. We
*never* execute destructive operations directly from the UI thread — we
enqueue a command and let the orchestrator main loop dispatch it. This
gives us:

  - audit log (every command is persisted with creator + result)
  - rate limiting / pause behavior (orchestrator can drain on its terms)
  - safety (a dashboard click cannot, on its own, push to GitHub)

Command types accepted in M2 (the orchestrator dispatcher in M6/M10 will
grow more):

  start_task            { repo_id, goal, payload? }
  pause_repo            { repo_id }
  resume_repo           { repo_id }
  pause_task            { task_id }
  resume_task           { task_id, to_status? }
  stop_task             { task_id }
  stop_all              {}
  explain_stuck         { task_id }
  approve_merge         { repo_id, pr_number }
  reject_merge          { repo_id, pr_number }
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator.ids import env_user, make_id, utc_now_iso


class CommandStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    rejected = "rejected"
    requires_approval = "requires_approval"


VALID_COMMAND_TYPES = {
    "start_task",
    "pause_repo",
    "resume_repo",
    "pause_task",
    "resume_task",
    "stop_task",
    "stop_all",
    "explain_stuck",
    "approve_merge",
    "reject_merge",
    "approve_command",
    "reject_command",
    "set_mode",
}


@dataclass(frozen=True)
class Command:
    id: str
    created_at: str
    created_by: str
    source: str
    command_type: str
    repo_id: str | None
    task_id: str | None
    pr_number: int | None
    payload: dict[str, Any]
    status: str
    result: dict[str, Any] | None
    error: str | None
    started_at: str | None
    finished_at: str | None


def _row_to_command(row) -> Command:
    return Command(
        id=row["id"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        source=row["source"],
        command_type=row["command_type"],
        repo_id=row["repo_id"],
        task_id=row["task_id"],
        pr_number=row["pr_number"],
        payload=json.loads(row["payload_json"] or "{}"),
        status=row["status"],
        result=json.loads(row["result_json"]) if row["result_json"] else None,
        error=row["error"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def enqueue(
    command_type: str,
    *,
    payload: dict[str, Any] | None = None,
    repo_id: str | None = None,
    task_id: str | None = None,
    pr_number: int | None = None,
    source: str = "cli",
    created_by: str | None = None,
    requires_approval: bool = False,
    db_path: Path | str | None = None,
) -> Command:
    """Insert a new command in status=queued (or requires_approval)."""
    if command_type not in VALID_COMMAND_TYPES:
        raise ValueError(f"unknown command_type {command_type!r}")
    status = CommandStatus.requires_approval if requires_approval else CommandStatus.queued
    cid = make_id("cmd")
    now = utc_now_iso()
    by = created_by or env_user()
    with open_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO commands (id, created_at, created_by, source, command_type,
                                  repo_id, task_id, pr_number, payload_json, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (cid, now, by, source, command_type, repo_id, task_id, pr_number,
             json.dumps(payload or {}), status.value),
        )
        return _fetch_one(conn, cid)


def claim_next(
    types: list[str] | None = None,
    db_path: Path | str | None = None,
) -> Command | None:
    """Atomically move the oldest queued command of ``types`` to running."""
    where = "status = 'queued'"
    args: list[Any] = []
    if types:
        placeholders = ",".join(["?"] * len(types))
        where += f" AND command_type IN ({placeholders})"
        args.extend(types)
    with open_db(db_path) as conn:
        # SQLite doesn't have FOR UPDATE; rely on isolation_level=None +
        # serial access pattern in v1. Sufficient for one orchestrator process.
        row = conn.execute(
            f"SELECT id FROM commands WHERE {where} ORDER BY created_at ASC LIMIT 1",
            args,
        ).fetchone()
        if row is None:
            return None
        cid = row["id"]
        now = utc_now_iso()
        conn.execute(
            "UPDATE commands SET status = ?, started_at = ? WHERE id = ?",
            (CommandStatus.running.value, now, cid),
        )
        return _fetch_one(conn, cid)


def complete(
    command_id: str,
    status: CommandStatus,
    *,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    db_path: Path | str | None = None,
) -> Command:
    if status in (CommandStatus.queued, CommandStatus.running):
        raise ValueError(f"complete() requires terminal status, got {status.value}")
    now = utc_now_iso()
    with open_db(db_path) as conn:
        conn.execute(
            """
            UPDATE commands SET status = ?, result_json = ?, error = ?, finished_at = ?
            WHERE id = ?
            """,
            (status.value, json.dumps(result) if result else None, error, now, command_id),
        )
        return _fetch_one(conn, command_id)


def list_commands(
    *,
    status: str | None = None,
    limit: int = 100,
    db_path: Path | str | None = None,
) -> list[Command]:
    where = "WHERE status = ?" if status else ""
    args: list[Any] = [status] if status else []
    with open_db(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM commands {where} ORDER BY created_at DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
        return [_row_to_command(r) for r in rows]


def get_command(command_id: str, db_path: Path | str | None = None) -> Command | None:
    with open_db(db_path) as conn:
        row = conn.execute("SELECT * FROM commands WHERE id = ?", (command_id,)).fetchone()
        return _row_to_command(row) if row else None


def _fetch_one(conn, cid: str) -> Command:
    row = conn.execute("SELECT * FROM commands WHERE id = ?", (cid,)).fetchone()
    if row is None:
        raise RuntimeError(f"command {cid} disappeared")
    return _row_to_command(row)
