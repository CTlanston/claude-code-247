"""System / repo / task runtime flags.

Sits on top of the ``system_state`` table. Keys are dotted; values are
small strings (we use ``"1"`` for "on"). Everything goes through here so
there's exactly one place to look when "why is the dispatcher idle"
becomes the question.
"""
from __future__ import annotations

from pathlib import Path

from memory.db import open_db
from orchestrator.ids import utc_now_iso

SYSTEM_PAUSED_KEY = "system.paused"


def _set(key: str, value: str, *, db_path: Path | str | None = None) -> None:
    with open_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                            updated_at = excluded.updated_at
            """,
            (key, value, utc_now_iso()),
        )


def _get(key: str, *, db_path: Path | str | None = None) -> str | None:
    with open_db(db_path) as conn:
        row = conn.execute(
            "SELECT value FROM system_state WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None


def _delete(key: str, *, db_path: Path | str | None = None) -> None:
    with open_db(db_path) as conn:
        conn.execute("DELETE FROM system_state WHERE key = ?", (key,))


# ── system pause ────────────────────────────────────────────────────


def is_system_paused(*, db_path: Path | str | None = None) -> bool:
    return _get(SYSTEM_PAUSED_KEY, db_path=db_path) == "1"


def pause_system(*, db_path: Path | str | None = None) -> None:
    _set(SYSTEM_PAUSED_KEY, "1", db_path=db_path)


def resume_system(*, db_path: Path | str | None = None) -> None:
    _delete(SYSTEM_PAUSED_KEY, db_path=db_path)


# ── repo pause ──────────────────────────────────────────────────────


def is_repo_paused(repo_id: str, *, db_path: Path | str | None = None) -> bool:
    return _get(f"repo.paused.{repo_id}", db_path=db_path) == "1"


def pause_repo(repo_id: str, *, db_path: Path | str | None = None) -> None:
    _set(f"repo.paused.{repo_id}", "1", db_path=db_path)


def resume_repo(repo_id: str, *, db_path: Path | str | None = None) -> None:
    _delete(f"repo.paused.{repo_id}", db_path=db_path)


def snapshot(*, db_path: Path | str | None = None) -> dict[str, str]:
    """Return all current flags. Used by `claude247 status`."""
    with open_db(db_path) as conn:
        rows = list(conn.execute("SELECT key, value FROM system_state"))
    return {r["key"]: r["value"] for r in rows}
