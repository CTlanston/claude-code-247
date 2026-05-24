"""Alert deduplication.

A fingerprint within the dedup window collapses into a single ``alerts``
row whose ``count`` increments. M8 wires the notification manager to
call ``emit`` for every actionable event; for M7 the function ships
with tests so the dashboard ``/alerts`` page has a stable read shape.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator.config import load_config
from orchestrator.ids import make_id, utc_now_iso

DEFAULT_DEDUP_MINUTES = 30


@dataclass(frozen=True)
class AlertSnapshot:
    id: str
    fingerprint: str
    alert_type: str
    severity: str
    repo_id: str | None
    task_id: str | None
    count: int
    first_seen_at: str
    last_seen_at: str
    acknowledged: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "fingerprint": self.fingerprint,
            "alert_type": self.alert_type, "severity": self.severity,
            "repo_id": self.repo_id, "task_id": self.task_id,
            "count": self.count, "first_seen_at": self.first_seen_at,
            "last_seen_at": self.last_seen_at,
            "acknowledged": self.acknowledged,
        }


def fingerprint(
    *,
    alert_type: str,
    repo_id: str | None,
    task_id: str | None,
    detail: str = "",
) -> str:
    """SHA1 of the (type, repo, task, detail) tuple."""
    h = hashlib.sha1()
    h.update(b"|".join(str(x or "").encode("utf-8")
                       for x in (alert_type, repo_id, task_id, detail)))
    return h.hexdigest()[:16]


def emit(
    *,
    alert_type: str,
    severity: str,
    message: str,
    repo_id: str | None = None,
    task_id: str | None = None,
    detail: str = "",
    payload: dict[str, Any] | None = None,
    dedup_minutes: int | None = None,
    db_path: Path | str | None = None,
) -> AlertSnapshot:
    """Emit (or coalesce) an alert. If a row with the same fingerprint
    was last seen within ``dedup_minutes``, increment its count."""
    if dedup_minutes is None:
        cfg = load_config()
        dedup_minutes = int(cfg.get("notifications.dedup_window_minutes",
                                     DEFAULT_DEDUP_MINUTES))
    fp = fingerprint(alert_type=alert_type, repo_id=repo_id,
                      task_id=task_id, detail=detail)
    now = utc_now_iso()
    import json as _json
    with open_db(db_path) as conn:
        if dedup_minutes <= 0:
            # Caller asked for no dedup — emit a fresh row every time.
            existing = None
        else:
            cutoff = _cutoff_iso(dedup_minutes)
            existing = conn.execute(
                "SELECT * FROM alerts WHERE fingerprint = ? AND last_seen_at >= ? "
                "ORDER BY last_seen_at DESC LIMIT 1",
                (fp, cutoff),
            ).fetchone()
        if existing is not None:
            conn.execute(
                "UPDATE alerts SET count = count + 1, last_seen_at = ?, payload_json = ? "
                "WHERE id = ?",
                (now, _json.dumps(payload) if payload else existing["payload_json"], existing["id"]),
            )
            row = conn.execute("SELECT * FROM alerts WHERE id = ?", (existing["id"],)).fetchone()
        else:
            aid = make_id("alt")
            conn.execute(
                """
                INSERT INTO alerts (id, created_at, alert_type, severity, repo_id,
                                    task_id, fingerprint, count, first_seen_at,
                                    last_seen_at, acknowledged, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?)
                """,
                (aid, now, alert_type, severity, repo_id, task_id, fp, now, now,
                 _json.dumps(payload) if payload else None),
            )
            row = conn.execute("SELECT * FROM alerts WHERE id = ?", (aid,)).fetchone()
    return _row(row)


def list_open(limit: int = 100, db_path: Path | str | None = None) -> list[AlertSnapshot]:
    with open_db(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM alerts WHERE acknowledged = 0 "
            "ORDER BY last_seen_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_row(r) for r in rows]


def acknowledge(alert_id: str, db_path: Path | str | None = None) -> None:
    with open_db(db_path) as conn:
        conn.execute("UPDATE alerts SET acknowledged = 1 WHERE id = ?", (alert_id,))


def _cutoff_iso(minutes: int) -> str:
    """ISO timestamp ``minutes`` ago."""
    cutoff = time.time() - minutes * 60
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(cutoff)) + ".000Z"


def _row(row) -> AlertSnapshot:
    return AlertSnapshot(
        id=row["id"], fingerprint=row["fingerprint"], alert_type=row["alert_type"],
        severity=row["severity"], repo_id=row["repo_id"], task_id=row["task_id"],
        count=int(row["count"]), first_seen_at=row["first_seen_at"],
        last_seen_at=row["last_seen_at"],
        acknowledged=bool(row["acknowledged"]),
    )
