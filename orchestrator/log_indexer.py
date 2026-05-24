"""Structured log writer + search.

Every component writes through this so the dashboard `/logs` page can
filter and full-text search across the whole system. SQLite's FTS5
table ``logs_fts`` is wired automatically by triggers in schema.sql.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator.ids import make_id, utc_now_iso

VALID_LEVELS = ("debug", "info", "warn", "error")


@dataclass(frozen=True)
class LogEntry:
    id: str
    created_at: str
    level: str
    component: str
    repo_id: str | None
    task_id: str | None
    run_id: str | None
    message: str
    payload: dict[str, Any] | None
    fingerprint: str | None


def write(
    *,
    level: str,
    component: str,
    message: str,
    repo_id: str | None = None,
    task_id: str | None = None,
    run_id: str | None = None,
    payload: dict[str, Any] | None = None,
    fingerprint: str | None = None,
    db_path: Path | str | None = None,
) -> str:
    if level not in VALID_LEVELS:
        raise ValueError(f"unknown log level {level!r}")
    lid = make_id("log")
    now = utc_now_iso()
    with open_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO logs (id, created_at, level, component, repo_id, task_id,
                              run_id, message, payload_json, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (lid, now, level, component, repo_id, task_id, run_id, message,
             json.dumps(payload) if payload else None, fingerprint),
        )
    return lid


def search(
    *,
    text: str | None = None,
    level: str | None = None,
    component: str | None = None,
    repo_id: str | None = None,
    task_id: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 200,
    db_path: Path | str | None = None,
) -> list[LogEntry]:
    """Filtered log search. FTS5 is used when ``text`` is set."""
    where: list[str] = []
    args: list[Any] = []

    if text:
        where.append("logs.rowid IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)")
        args.append(text)
    if level:
        where.append("level = ?")
        args.append(level)
    if component:
        where.append("component = ?")
        args.append(component)
    if repo_id:
        where.append("repo_id = ?")
        args.append(repo_id)
    if task_id:
        where.append("task_id = ?")
        args.append(task_id)
    if since:
        where.append("created_at >= ?")
        args.append(since)
    if until:
        where.append("created_at <= ?")
        args.append(until)

    clause = ("WHERE " + " AND ".join(where)) if where else ""
    sql = (f"SELECT id, created_at, level, component, repo_id, task_id, run_id, "
           f"message, payload_json, fingerprint FROM logs {clause} "
           "ORDER BY created_at DESC LIMIT ?")
    args.append(limit)
    with open_db(db_path) as conn:
        rows = conn.execute(sql, args).fetchall()
        return [
            LogEntry(
                id=r["id"], created_at=r["created_at"], level=r["level"],
                component=r["component"], repo_id=r["repo_id"], task_id=r["task_id"],
                run_id=r["run_id"], message=r["message"],
                payload=json.loads(r["payload_json"]) if r["payload_json"] else None,
                fingerprint=r["fingerprint"],
            )
            for r in rows
        ]


def tail(
    *,
    repo_id: str | None = None,
    task_id: str | None = None,
    limit: int = 50,
    db_path: Path | str | None = None,
) -> list[LogEntry]:
    """Most recent N log entries optionally scoped to repo/task."""
    return search(repo_id=repo_id, task_id=task_id, limit=limit, db_path=db_path)
