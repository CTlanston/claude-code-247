"""Memory compiler — turn recent runtime history into durable summaries.

Daily and weekly modes scan the SQLite state for new failures, review
lessons, and decisions, then append a section to the per-repo
``.agent/*.md`` files.

The compiler is intentionally light on judgement: it summarizes counts,
selects a few representative quotes, and lets the Planner / human read
the details inline. We don't try to be clever — that's the Planner's
job.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory.db import open_db
from memory.repo_memory import AgentMemory
from memory.vector_store import MemoryItem, make_store
from orchestrator.repo_registry import RepoEntry, load_registry


WINDOW_DAYS = {"daily": 1, "weekly": 7}


def _cutoff_iso(days: int) -> str:
    cutoff = time.time() - days * 86400
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(cutoff)) + ".000Z"


@dataclass
class CompileResult:
    repo_id: str
    window: str
    files_updated: list[str]
    memory_items_added: int
    notes: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "repo_id": self.repo_id, "window": self.window,
            "files_updated": list(self.files_updated),
            "memory_items_added": self.memory_items_added,
            "notes": list(self.notes),
        }


def compile_repo(
    repo: RepoEntry,
    *,
    window: str = "daily",
    db_path: Path | str | None = None,
) -> CompileResult:
    if window not in WINDOW_DAYS:
        raise ValueError(f"unknown window {window!r}")
    days = WINDOW_DAYS[window]
    cutoff = _cutoff_iso(days)
    notes: list[str] = []
    files_updated: list[str] = []

    with open_db(db_path) as conn:
        failed_tasks = list(conn.execute(
            "SELECT id, goal, status, created_at FROM tasks "
            "WHERE repo_id = ? AND status IN ('failed','stuck') "
            "AND created_at >= ? ORDER BY created_at DESC",
            (repo.id, cutoff),
        ).fetchall())
        validator_fails = list(conn.execute(
            """
            SELECT vr.validator, vr.verdict, vr.summary, vr.created_at, vr.task_id
            FROM validator_results vr
            JOIN tasks t ON t.id = vr.task_id
            WHERE t.repo_id = ? AND vr.created_at >= ? AND vr.verdict <> 'PASS'
            ORDER BY vr.created_at DESC LIMIT 30
            """,
            (repo.id, cutoff),
        ).fetchall())
        decisions = list(conn.execute(
            "SELECT topic, decision, rationale, created_at FROM decisions "
            "WHERE repo_id = ? AND created_at >= ? ORDER BY created_at DESC",
            (repo.id, cutoff),
        ).fetchall())

    if not (failed_tasks or validator_fails or decisions):
        notes.append("no new failures, decisions, or validator events in window")

    mem = AgentMemory(repo_path=Path(repo.local_path).expanduser())
    store = make_store(db_path=db_path)
    items_added = 0

    if failed_tasks:
        body = _render_failures_section(window, failed_tasks)
        mem.append("FAILURES", body)
        files_updated.append(str(mem.path("FAILURES")))
        for t in failed_tasks:
            store.add(MemoryItem(
                repo_id=repo.id, item_type="failure",
                text=f"task {t['id']} {t['status']}: {t['goal']}",
                metadata={"task_id": t["id"], "created_at": t["created_at"]},
            ))
            items_added += 1

    if validator_fails:
        body = _render_review_lessons(window, validator_fails)
        mem.append("REVIEW_LESSONS", body)
        files_updated.append(str(mem.path("REVIEW_LESSONS")))
        for v in validator_fails:
            store.add(MemoryItem(
                repo_id=repo.id, item_type="review",
                text=f"{v['validator']} {v['verdict']}: {v['summary'] or ''}",
                metadata={"task_id": v["task_id"], "created_at": v["created_at"]},
            ))
            items_added += 1

    if decisions:
        body = _render_decisions(window, decisions)
        mem.append("DECISIONS", body)
        files_updated.append(str(mem.path("DECISIONS")))
        for d in decisions:
            store.add(MemoryItem(
                repo_id=repo.id, item_type="decision",
                text=f"{d['topic']} -> {d['decision']}: {d['rationale'] or ''}",
                metadata={"created_at": d["created_at"]},
            ))
            items_added += 1

    return CompileResult(repo_id=repo.id, window=window,
                         files_updated=files_updated,
                         memory_items_added=items_added, notes=notes)


def compile_all(*, window: str = "daily",
                db_path: Path | str | None = None) -> list[CompileResult]:
    return [compile_repo(r, window=window, db_path=db_path) for r in load_registry()]


# ────────────────────────────────────────────────────────────────────


def _hdr(window: str) -> str:
    return time.strftime(f"## {window} digest — %Y-%m-%dT%H:%MZ", time.gmtime())


def _render_failures_section(window: str, rows) -> str:
    lines = [_hdr(window), ""]
    for r in rows:
        lines.append(f"- `{r['id']}` [{r['status']}] {r['goal']} "
                     f"(at {r['created_at']})")
    return "\n".join(lines)


def _render_review_lessons(window: str, rows) -> str:
    lines = [_hdr(window), ""]
    for r in rows:
        summary = (r["summary"] or "").splitlines()[0][:120]
        lines.append(f"- `{r['validator']}` {r['verdict']} on `{r['task_id']}`: "
                     f"{summary}")
    return "\n".join(lines)


def _render_decisions(window: str, rows) -> str:
    lines = [_hdr(window), ""]
    for r in rows:
        lines.append(f"### {r['topic']}\n"
                     f"- decision: {r['decision']}\n"
                     f"- rationale: {r['rationale'] or '(none)'}\n"
                     f"- at: {r['created_at']}")
    return "\n\n".join(lines)


def retrieve_for_planning(
    *,
    repo_id: str,
    goal: str,
    k: int = 5,
    db_path: Path | str | None = None,
) -> list[Any]:
    """Pre-planning retrieval: pull memory items most relevant to ``goal``.

    Returned hits feed the Planner prompt. We bias toward failures and
    review lessons since those are the most actionable.
    """
    store = make_store(db_path=db_path)
    hits = []
    for kind in ("failure", "review", "decision", "lesson"):
        hits.extend(store.search(goal, repo_id=repo_id, item_type=kind,
                                 k=k))
    return hits[: k * 2]
