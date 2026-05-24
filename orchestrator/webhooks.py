"""GitHub webhook event handling.

The dashboard exposes ``POST /webhooks/github``. We validate the HMAC
signature (configured via ``github.webhook_secret`` in
``~/.claude-code-247/config.yaml``) and dispatch the payload here.

Supported events (the rest are accepted with a noop):

  pull_request   — sync ``prs`` state, approval_state, merged_at
  check_run      — append to ``ci_results`` for the matching PR
  check_suite    — same idea, suite-level
  status         — legacy commit-status API; also tracked in ci_results

Each handler is small and pure: ``handle(payload) -> dict`` returning a
summary the route writes back to the client (for debugging) and to the
audit log.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from memory.db import open_db
from orchestrator import log_indexer, notification_manager
from orchestrator.ids import make_id, utc_now_iso


class WebhookError(RuntimeError):
    pass


@dataclass(frozen=True)
class WebhookOutcome:
    event: str
    action: str | None
    handled: bool
    summary: dict[str, Any]


def verify_signature(*, body: bytes, signature_header: str | None,
                      secret: str) -> bool:
    """GitHub uses HMAC-SHA256 with the format ``sha256=<hex>``."""
    if not signature_header or not secret:
        return False
    if not signature_header.startswith("sha256="):
        return False
    sig = signature_header.split("=", 1)[1]
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, sig)


def dispatch(*, event: str, payload: dict[str, Any],
              notify_fn: Callable[..., Any] | None = None,
              db_path: Path | str | None = None) -> WebhookOutcome:
    """Route the event to its handler. Unknown events are accepted as
    no-ops so GitHub doesn't retry — but logged."""
    handler = HANDLERS.get(event)
    action = payload.get("action") if isinstance(payload, dict) else None
    if handler is None:
        log_indexer.write(
            level="info", component="webhooks",
            message=f"github event ignored: {event} action={action}",
            payload={"event": event, "action": action},
            db_path=db_path,
        )
        return WebhookOutcome(event=event, action=action, handled=False,
                               summary={"ignored": True})
    summary = handler(payload, notify_fn=notify_fn or notification_manager.notify,
                      db_path=db_path)
    log_indexer.write(
        level="info", component="webhooks",
        message=f"github event handled: {event} action={action}",
        payload={"event": event, "action": action, "summary": summary},
        db_path=db_path,
    )
    return WebhookOutcome(event=event, action=action, handled=True,
                           summary=summary)


# ── handlers ────────────────────────────────────────────────────────


def handle_pull_request(payload: dict[str, Any], *, notify_fn, db_path) -> dict:
    pr = payload.get("pull_request") or {}
    repo = (payload.get("repository") or {})
    repo_full = repo.get("full_name") or ""
    if not repo_full or not pr:
        return {"error": "missing repository/pull_request"}
    owner, _, name = repo_full.partition("/")
    number = pr.get("number")
    if number is None:
        return {"error": "missing pr number"}
    merged = bool(pr.get("merged"))
    state = "merged" if merged else (
        "draft" if pr.get("draft") else str(pr.get("state") or "open"))
    merged_at = pr.get("merged_at") or None

    now = utc_now_iso()
    with open_db(db_path) as conn:
        repo_row = conn.execute(
            "SELECT id FROM repos WHERE github_owner = ? AND github_repo = ?",
            (owner, name),
        ).fetchone()
        if repo_row is None:
            return {"unknown_repo": repo_full}
        repo_id = repo_row["id"]
        existing = conn.execute(
            "SELECT id FROM prs WHERE repo_id = ? AND pr_number = ?",
            (repo_id, number),
        ).fetchone()
        if existing is None:
            return {"unknown_pr": number}
        sets = ["state = ?", "updated_at = ?"]
        args: list[Any] = [state, now]
        if merged_at:
            sets.append("merged_at = ?")
            args.append(merged_at)
        args.append(existing["id"])
        conn.execute(f"UPDATE prs SET {', '.join(sets)} WHERE id = ?", args)

    if merged:
        notify_fn(event="auto_merge_completed",
                   message=f"{repo_full}#{number} merged via webhook",
                   repo_id=repo_id, pr_number=number)
    return {"updated_pr": number, "state": state, "merged": merged}


def handle_check_run(payload: dict[str, Any], *, notify_fn, db_path) -> dict:
    return _record_check_event("check_run", payload,
                                notify_fn=notify_fn, db_path=db_path)


def handle_check_suite(payload: dict[str, Any], *, notify_fn, db_path) -> dict:
    return _record_check_event("check_suite", payload,
                                notify_fn=notify_fn, db_path=db_path)


def handle_status(payload: dict[str, Any], *, notify_fn, db_path) -> dict:
    """Commit-status API — pre-checks. Treats ``state`` as the verdict
    and the sha as the join point. We only record when we can locate a
    tracked PR via head_sha."""
    return _record_check_event("status", payload,
                                notify_fn=notify_fn, db_path=db_path)


def handle_ping(payload: dict[str, Any], *, notify_fn, db_path) -> dict:
    """GitHub sends ``ping`` once when a webhook is created and again on
    demand via the ``/pings`` API. The payload includes a ``zen`` line
    and the ``hook_id``. Accept it explicitly so it shows up as
    ``handled`` rather than ``ignored`` in the audit log."""
    return {
        "zen": payload.get("zen", ""),
        "hook_id": payload.get("hook_id"),
    }


HANDLERS: dict[str, Callable[..., dict]] = {
    "pull_request": handle_pull_request,
    "check_run": handle_check_run,
    "check_suite": handle_check_suite,
    "status": handle_status,
    "ping": handle_ping,
}


# ── internals ───────────────────────────────────────────────────────


def _record_check_event(event: str, payload: dict[str, Any],
                         *, notify_fn, db_path) -> dict:
    repo = (payload.get("repository") or {})
    repo_full = repo.get("full_name") or ""
    if not repo_full:
        return {"error": "missing repository"}
    owner, _, name = repo_full.partition("/")

    body = payload.get(event) or {}
    pr_numbers: list[int] = []
    for pr in (body.get("pull_requests") or []):
        n = pr.get("number")
        if isinstance(n, int):
            pr_numbers.append(n)
    if not pr_numbers and event == "status":
        # Status events carry sha only — we don't try to translate sha→PR
        # here (would require gh search). Logged + accepted.
        return {"sha": payload.get("sha"), "noop": "status not tied to PR"}

    # For check_run/check_suite: `status` is the lifecycle (queued/in_progress/
    # completed); the actual verdict is `conclusion`. Prefer conclusion when
    # the lifecycle says "completed".
    raw_status = body.get("status") or ""
    raw_conclusion = body.get("conclusion") or ""
    if str(raw_status).lower() == "completed" and raw_conclusion:
        status = str(raw_conclusion).lower()
    else:
        status = str(raw_status or raw_conclusion
                      or payload.get("state") or "").lower()
    name_field = body.get("name") or body.get("context") or event
    now = utc_now_iso()
    inserted = 0
    with open_db(db_path) as conn:
        repo_row = conn.execute(
            "SELECT id FROM repos WHERE github_owner = ? AND github_repo = ?",
            (owner, name),
        ).fetchone()
        if repo_row is None:
            return {"unknown_repo": repo_full}
        repo_id = repo_row["id"]
        for pn in pr_numbers:
            pr_row = conn.execute(
                "SELECT id, task_id FROM prs WHERE repo_id = ? AND pr_number = ?",
                (repo_id, pn),
            ).fetchone()
            if pr_row is None:
                continue
            conn.execute(
                "INSERT INTO ci_results (id, pr_id, task_id, workflow_name, "
                "status, url, created_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
                (make_id("ci"), pr_row["id"], pr_row["task_id"],
                 name_field, status,
                 body.get("html_url") or body.get("url") or "",
                 now, json.dumps(payload, sort_keys=True)),
            )
            inserted += 1
            if status in ("failure", "failed"):
                notify_fn(event="validation_failed",
                           message=f"{repo_full}#{pn} CI: {name_field} {status}",
                           repo_id=repo_id, pr_number=pn)
    return {"ci_rows_inserted": inserted, "event": event, "status": status}
