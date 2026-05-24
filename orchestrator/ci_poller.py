"""Poll GitHub CI status for tracked PRs and write into ``ci_results``.

Run on every dispatcher tick (cheap when there are no open PRs).
For each PR whose state is ``draft`` or ``open`` and whose last CI poll
is older than ``poll_min_seconds``, call ``gh pr checks`` and:

  * upsert a ``ci_results`` row per check
  * derive an aggregate verdict (success | failure | pending | mixed)
  * if any check transitioned PASS→FAIL or vice versa, emit a
    notification and a log entry
  * when an AUTO_MERGE-eligible task is waiting on CI and CI just turned
    green, the dispatcher's next tick can use this to fire `gh pr merge`
    (M12.5+ wiring).
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory.db import open_db
from orchestrator import github_client as _github_client, log_indexer
from orchestrator.ids import make_id, utc_now_iso

DEFAULT_POLL_MIN_SECONDS = 60.0


@dataclass
class CIPollResult:
    repo: str
    pr_number: int
    checks_seen: int
    verdict: str            # success | failure | pending | mixed | unknown
    changed: bool           # True when the aggregate verdict moved


def poll_open_prs(
    *,
    github=None,
    db_path: Path | str | None = None,
    min_poll_seconds: float = DEFAULT_POLL_MIN_SECONDS,
    now: float | None = None,
) -> list[CIPollResult]:
    """Walk all draft/open PRs in the prs table and refresh their checks.

    A PR is skipped when the most recent ci_results row is younger than
    ``min_poll_seconds``. That keeps the poller from hammering gh on every
    30-second dispatcher tick.
    """
    gh = github or _github_client
    now = now if now is not None else time.time()
    results: list[CIPollResult] = []
    with open_db(db_path) as conn:
        prs = list(conn.execute(
            "SELECT id, repo_id, pr_number FROM prs "
            "WHERE state IN ('draft', 'open') ORDER BY updated_at ASC LIMIT 50"
        ))
        repo_map = {
            r["id"]: (r["github_owner"], r["github_repo"])
            for r in conn.execute(
                "SELECT id, github_owner, github_repo FROM repos"
            )
        }
    for pr in prs:
        owner_repo = repo_map.get(pr["repo_id"])
        if not owner_repo:
            continue
        repo_slug = f"{owner_repo[0]}/{owner_repo[1]}"
        if _too_recent(pr["id"], min_poll_seconds, now, db_path=db_path):
            continue
        try:
            checks = gh.pr_checks(repo_slug, pr["pr_number"])
        except _github_client.GitHubError as e:
            log_indexer.write(level="warn", component="ci_poller",
                               message=f"gh pr checks failed for {repo_slug}#{pr['pr_number']}: {e}",
                               repo_id=pr["repo_id"], db_path=db_path)
            continue
        prior = _current_verdict(pr["id"], db_path=db_path)
        _record_checks(pr["id"], checks, db_path=db_path)
        verdict = _aggregate_verdict(checks)
        changed = (prior is not None and prior != verdict)
        if changed:
            log_indexer.write(level="info", component="ci_poller",
                               message=f"CI {prior} → {verdict} for {repo_slug}#{pr['pr_number']}",
                               repo_id=pr["repo_id"], db_path=db_path)
        results.append(CIPollResult(
            repo=repo_slug, pr_number=pr["pr_number"],
            checks_seen=len(checks), verdict=verdict, changed=changed,
        ))
    return results


# ── helpers ─────────────────────────────────────────────────────────


def _too_recent(pr_id: str, min_poll: float, now: float, *,
                 db_path: Path | str | None) -> bool:
    """True when the latest ci_results row is younger than min_poll."""
    with open_db(db_path) as conn:
        row = conn.execute(
            "SELECT MAX(created_at) AS latest FROM ci_results WHERE pr_id = ?",
            (pr_id,),
        ).fetchone()
    if row is None or not row["latest"]:
        return False
    # parse the ISO timestamp; tolerant
    try:
        age = now - _iso_to_epoch(row["latest"])
    except ValueError:
        return False
    return age < min_poll


def _iso_to_epoch(iso: str) -> float:
    # 2026-05-24T13:00:00.123Z → epoch
    if iso.endswith("Z"):
        iso = iso[:-1]
    if "." in iso:
        iso, ms = iso.rsplit(".", 1)
        ms_part = float("0." + ms.rstrip())
    else:
        ms_part = 0.0
    t = time.strptime(iso, "%Y-%m-%dT%H:%M:%S")
    import calendar
    return calendar.timegm(t) + ms_part


def _record_checks(pr_id: str, checks: list[dict[str, Any]], *,
                    db_path: Path | str | None) -> None:
    now = utc_now_iso()
    with open_db(db_path) as conn:
        for c in checks:
            conn.execute(
                """
                INSERT INTO ci_results (id, pr_id, workflow_name, status, url,
                                         created_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (make_id("ci"), pr_id,
                 c.get("workflow") or c.get("name") or "",
                 _normalize_status(c),
                 c.get("link") or "",
                 now,
                 json.dumps(c, sort_keys=True)),
            )


def _normalize_status(check: dict[str, Any]) -> str:
    bucket = (check.get("bucket") or "").lower()
    state = (check.get("state") or check.get("status") or "").lower()
    raw = bucket or state or "unknown"
    # gh emits: pass / fail / pending / skipping / cancel
    mapping = {
        "pass": "success", "success": "success", "completed_success": "success",
        "fail": "failure", "failure": "failure", "completed_failure": "failure",
        "pending": "pending", "queued": "pending", "in_progress": "pending",
        "skipping": "skipped", "skipped": "skipped",
        "cancel": "cancelled", "cancelled": "cancelled",
    }
    return mapping.get(raw, raw)


def _aggregate_verdict(checks: list[dict[str, Any]]) -> str:
    if not checks:
        return "unknown"
    statuses = [_normalize_status(c) for c in checks]
    if all(s == "success" for s in statuses):
        return "success"
    if any(s == "failure" for s in statuses):
        return "failure"
    if any(s == "pending" for s in statuses):
        return "pending"
    if set(statuses) <= {"success", "skipped", "cancelled"}:
        return "success"
    return "mixed"


def _current_verdict(pr_id: str, *,
                      db_path: Path | str | None) -> str | None:
    """Reconstruct the latest verdict from the most recent batch of
    ci_results rows for this PR. None when no rows yet."""
    with open_db(db_path) as conn:
        latest = conn.execute(
            "SELECT MAX(created_at) AS latest FROM ci_results WHERE pr_id = ?",
            (pr_id,),
        ).fetchone()
        if not latest or not latest["latest"]:
            return None
        rows = conn.execute(
            "SELECT payload_json FROM ci_results WHERE pr_id = ? AND created_at = ?",
            (pr_id, latest["latest"]),
        ).fetchall()
    try:
        checks = [json.loads(r["payload_json"]) for r in rows if r["payload_json"]]
    except json.JSONDecodeError:
        return None
    return _aggregate_verdict(checks)
