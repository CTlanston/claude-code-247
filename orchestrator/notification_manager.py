"""Notifications — log + ntfy.sh.

Every actionable event flows through ``notify``. The orchestrator wires:

  task_started, task_completed, task_stuck, task_failed,
  pr_created, validation_failed, approval_required,
  auto_merge_completed, budget_exceeded, system_paused, doctor_failed

Each call writes a row to the ``notifications`` table (audit, append-only)
AND, if a ntfy topic is configured, sends a push. Dedup is borrowed from
``alert_deduper.fingerprint``: same (event, repo, task, detail) inside the
dedup window collapses into a single ntfy push so the operator's phone
doesn't melt during a flap.

Channel "log" is always used (DB row + stderr); "ntfy" is added when
``notifications.ntfy.topic`` is set in config.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from memory.db import open_db
from orchestrator import alert_deduper
from orchestrator.config import load_config
from orchestrator.ids import make_id, utc_now_iso

NOTIFY_EVENTS = frozenset({
    "task_started", "task_completed", "task_stuck", "task_failed",
    "pr_created", "validation_failed", "approval_required",
    "auto_merge_completed", "budget_exceeded", "system_paused",
    "doctor_failed",
})

DEFAULT_TITLES = {
    "task_started": "task started",
    "task_completed": "task completed",
    "task_stuck": "task stuck",
    "task_failed": "task failed",
    "pr_created": "PR created",
    "validation_failed": "validators failed",
    "approval_required": "approval required",
    "auto_merge_completed": "auto-merge completed",
    "budget_exceeded": "budget exceeded",
    "system_paused": "system paused",
    "doctor_failed": "doctor failed",
}

PRIORITY_BY_EVENT = {
    "approval_required": 5,
    "task_stuck": 4,
    "task_failed": 4,
    "budget_exceeded": 4,
    "doctor_failed": 4,
    "system_paused": 4,
    "validation_failed": 3,
    "pr_created": 3,
    "task_started": 2,
    "task_completed": 2,
    "auto_merge_completed": 2,
}


@dataclass
class NotificationOutcome:
    id: str
    event: str
    channels: list[str]
    delivered: bool
    fingerprint: str
    deduped: bool

    def to_dict(self) -> dict:
        return {
            "id": self.id, "event": self.event, "channels": list(self.channels),
            "delivered": self.delivered, "fingerprint": self.fingerprint,
            "deduped": self.deduped,
        }


def notify(
    *,
    event: str,
    message: str,
    repo_id: str | None = None,
    task_id: str | None = None,
    pr_number: int | None = None,
    detail: str = "",
    payload: dict[str, Any] | None = None,
    client: httpx.Client | None = None,
    db_path: Path | str | None = None,
) -> NotificationOutcome:
    if event not in NOTIFY_EVENTS:
        raise ValueError(f"unknown event {event!r}; allowed: {sorted(NOTIFY_EVENTS)}")
    cfg = load_config()
    ntfy_topic = (cfg.get("notifications.ntfy.topic") or "").strip()
    ntfy_server = (cfg.get("notifications.ntfy.server") or "https://ntfy.sh").rstrip("/")
    dedup_min = int(cfg.get("notifications.dedup_window_minutes", 30))

    fp = alert_deduper.fingerprint(alert_type=event, repo_id=repo_id,
                                    task_id=task_id, detail=detail or message)
    deduped = _is_duplicate(fp, dedup_min, db_path=db_path)

    nid = make_id("ntf")
    now = utc_now_iso()
    channels = ["log"]
    if ntfy_topic and not deduped:
        channels.append("ntfy")
    with open_db(db_path) as conn:
        for ch in channels:
            conn.execute(
                """
                INSERT INTO notifications (id, created_at, event_type, repo_id,
                                           task_id, pr_number, fingerprint,
                                           message, channel, delivered)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (make_id("ntf"), now, event, repo_id, task_id, pr_number,
                 fp, message, ch),
            )

    delivered = False
    if ntfy_topic and not deduped:
        delivered = _send_ntfy(
            client=client, server=ntfy_server, topic=ntfy_topic,
            event=event, message=message, repo_id=repo_id, task_id=task_id,
            pr_number=pr_number, payload=payload,
        )
        if delivered:
            with open_db(db_path) as conn:
                conn.execute(
                    "UPDATE notifications SET delivered = 1 WHERE fingerprint = ? "
                    "AND channel = 'ntfy' AND created_at = ?",
                    (fp, now),
                )

    return NotificationOutcome(id=nid, event=event, channels=channels,
                               delivered=delivered, fingerprint=fp,
                               deduped=deduped)


def _is_duplicate(fp: str, dedup_minutes: int, *,
                  db_path: Path | str | None) -> bool:
    if dedup_minutes <= 0:
        return False
    import time
    cutoff = time.time() - dedup_minutes * 60
    cutoff_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(cutoff)) + ".000Z"
    with open_db(db_path) as conn:
        row = conn.execute(
            "SELECT id FROM notifications WHERE fingerprint = ? AND channel = 'ntfy' "
            "AND created_at >= ? LIMIT 1",
            (fp, cutoff_iso),
        ).fetchone()
        return row is not None


def _send_ntfy(
    *,
    client: httpx.Client | None,
    server: str,
    topic: str,
    event: str,
    message: str,
    repo_id: str | None,
    task_id: str | None,
    pr_number: int | None,
    payload: dict[str, Any] | None,
) -> bool:
    title = DEFAULT_TITLES.get(event, event)
    if repo_id:
        # ASCII-only — httpx headers reject non-ASCII bytes and ntfy
        # serves the title back into push systems that also assume ASCII.
        title = f"{title} - {repo_id}"
    priority = PRIORITY_BY_EVENT.get(event, 3)
    tags = ["claude247", event]
    if pr_number is not None:
        tags.append(f"pr-{pr_number}")
    headers = {
        "Title": title,
        "Priority": str(priority),
        "Tags": ",".join(tags),
    }
    own_client = client is None
    client = client or httpx.Client(timeout=10.0)
    try:
        try:
            resp = client.post(f"{server}/{topic}", content=message.encode("utf-8"),
                               headers=headers)
            return 200 <= resp.status_code < 300
        except httpx.HTTPError:
            return False
    finally:
        if own_client:
            client.close()
