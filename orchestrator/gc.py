"""Background GC for runtime artifacts.

Two scopes:

  * **Workspaces** under ``~/.claude-code-247/workspaces/``.
    Prune directories older than ``system.workspace_gc_days``. We use the
    directory mtime as the age signal; the workspace's task_id is just a
    label here, no DB lookup needed.

  * **Log rows** in the ``logs`` table. Delete rows older than
    ``system.log_gc_days``. The FTS5 mirror is kept in sync by the
    ``logs_fts_del`` trigger we declared in schema.sql.

Also recovers **orphaned commands**: any ``commands`` row stuck in
``running`` with a ``started_at`` older than ``orphan_minutes`` is
flipped to ``failed`` with an explanatory error. This handles the case
where the dispatcher crashed mid-handler and left a command in limbo.
"""
from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator import log_indexer
from orchestrator.config import load_config
from orchestrator.ids import utc_now_iso
from orchestrator.runner_manager import default_workspace_root


@dataclass
class GCResult:
    workspaces_pruned: int
    log_rows_pruned: int
    orphan_commands_failed: int
    notes: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "workspaces_pruned": self.workspaces_pruned,
            "log_rows_pruned": self.log_rows_pruned,
            "orphan_commands_failed": self.orphan_commands_failed,
            "notes": list(self.notes),
        }


def run_gc(
    *,
    workspace_root: Path | None = None,
    db_path: Path | str | None = None,
    workspace_days: int | None = None,
    log_days: int | None = None,
    orphan_minutes: int = 60,
    now: float | None = None,
) -> GCResult:
    cfg = load_config()
    if workspace_days is None:
        workspace_days = int(cfg.get("system.workspace_gc_days", 14) or 14)
    if log_days is None:
        log_days = int(cfg.get("system.log_gc_days", 30) or 30)
    now = now if now is not None else time.time()

    notes: list[str] = []
    workspaces_pruned = _prune_workspaces(
        workspace_root or default_workspace_root(),
        max_age_days=workspace_days, now=now, notes=notes,
    )
    log_rows_pruned = _prune_logs(log_days, now=now,
                                   db_path=db_path, notes=notes)
    orphan_count = _recover_orphans(orphan_minutes, now=now,
                                     db_path=db_path, notes=notes)

    log_indexer.write(
        level="info", component="gc",
        message=(f"workspaces={workspaces_pruned} logs={log_rows_pruned} "
                 f"orphans={orphan_count}"),
        payload={"workspaces_pruned": workspaces_pruned,
                  "log_rows_pruned": log_rows_pruned,
                  "orphan_commands_failed": orphan_count},
        db_path=db_path,
    )
    return GCResult(
        workspaces_pruned=workspaces_pruned,
        log_rows_pruned=log_rows_pruned,
        orphan_commands_failed=orphan_count,
        notes=notes,
    )


# ── internals ───────────────────────────────────────────────────────


def _prune_workspaces(root: Path, *, max_age_days: int, now: float,
                       notes: list[str]) -> int:
    if not root.exists():
        return 0
    cutoff = now - max_age_days * 86400
    pruned = 0
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        try:
            mtime = child.stat().st_mtime
        except OSError:
            continue
        if mtime >= cutoff:
            continue
        try:
            shutil.rmtree(child)
            pruned += 1
        except OSError as e:
            notes.append(f"workspace prune failed for {child.name}: {e}")
    return pruned


def _prune_logs(max_age_days: int, *, now: float,
                 db_path: Path | str | None, notes: list[str]) -> int:
    cutoff = _iso_at_offset(now - max_age_days * 86400)
    try:
        with open_db(db_path) as conn:
            cur = conn.execute(
                "DELETE FROM logs WHERE created_at < ?", (cutoff,),
            )
            return cur.rowcount or 0
    except Exception as e:  # pragma: no cover — defensive
        notes.append(f"log prune failed: {e}")
        return 0


def _recover_orphans(orphan_minutes: int, *, now: float,
                      db_path: Path | str | None, notes: list[str]) -> int:
    cutoff = _iso_at_offset(now - orphan_minutes * 60)
    try:
        with open_db(db_path) as conn:
            cur = conn.execute(
                "UPDATE commands SET status = 'failed', "
                "error = COALESCE(error, '') || ' [gc: orphan recovery]', "
                "finished_at = ? "
                "WHERE status = 'running' AND started_at IS NOT NULL "
                "AND started_at < ?",
                (utc_now_iso(), cutoff),
            )
            return cur.rowcount or 0
    except Exception as e:  # pragma: no cover
        notes.append(f"orphan recovery failed: {e}")
        return 0


def _iso_at_offset(epoch: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(epoch)) + ".000Z"
