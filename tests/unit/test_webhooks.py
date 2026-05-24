from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path

import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator import webhooks
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed_repo_and_pr(*, pr_number: int = 11) -> tuple[str, str]:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "owner", "github_repo": "demo-repo",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))
    now = utc_now_iso()
    pid = make_id("pr")
    with open_db() as conn:
        tid = make_id("task")
        conn.execute(
            "INSERT INTO tasks (id, repo_id, goal, source, status, created_at, "
            "updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
            (tid, "demo", "g", "cli", "pr_created", now, now, "{}"),
        )
        conn.execute(
            "INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title, url, "
            "state, approval_state, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "demo", tid, pr_number, "agent/x/y/z", "t",
             "https://github.com/owner/demo-repo/pull/" + str(pr_number),
             "open", "required", now, now),
        )
    return "demo", pid


def test_verify_signature_valid() -> None:
    body = b'{"hello":"world"}'
    secret = "topsecret"
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert webhooks.verify_signature(
        body=body, signature_header=sig, secret=secret,
    ) is True


def test_verify_signature_wrong() -> None:
    body = b'{"x":1}'
    sig = "sha256=" + hmac.new(b"wrong", body, hashlib.sha256).hexdigest()
    assert webhooks.verify_signature(
        body=body, signature_header=sig, secret="topsecret",
    ) is False


def test_verify_signature_missing_header() -> None:
    assert webhooks.verify_signature(
        body=b"x", signature_header=None, secret="s",
    ) is False


def test_pull_request_merged_updates_pr_state() -> None:
    _seed_repo_and_pr(pr_number=12)
    fired: list = []
    def notify(*, event, message, **kw):
        fired.append(event)
    payload = {
        "action": "closed",
        "pull_request": {"number": 12, "merged": True, "draft": False,
                          "state": "closed",
                          "merged_at": "2026-05-24T15:00:00Z"},
        "repository": {"full_name": "owner/demo-repo"},
    }
    out = webhooks.dispatch(event="pull_request", payload=payload,
                             notify_fn=notify)
    assert out.handled
    assert out.summary["merged"] is True
    assert "auto_merge_completed" in fired
    with open_db() as conn:
        row = conn.execute("SELECT state, merged_at FROM prs WHERE pr_number = ?",
                            (12,)).fetchone()
        assert row["state"] == "merged"
        assert row["merged_at"] == "2026-05-24T15:00:00Z"


def test_pull_request_unknown_repo_is_noop() -> None:
    init_db()
    payload = {
        "action": "closed",
        "pull_request": {"number": 1, "merged": False, "state": "closed"},
        "repository": {"full_name": "other/repo"},
    }
    out = webhooks.dispatch(event="pull_request", payload=payload,
                             notify_fn=lambda **_: None)
    assert out.handled
    assert out.summary.get("unknown_repo") == "other/repo"


def test_check_run_records_ci_row() -> None:
    repo_id, pr_id = _seed_repo_and_pr(pr_number=21)
    fired: list = []
    payload = {
        "action": "completed",
        "check_run": {
            "name": "test", "status": "completed", "conclusion": "success",
            "html_url": "https://x",
            "pull_requests": [{"number": 21}],
        },
        "repository": {"full_name": "owner/demo-repo"},
    }
    out = webhooks.dispatch(event="check_run", payload=payload,
                             notify_fn=lambda **kw: fired.append(kw["event"]))
    assert out.handled
    assert out.summary["ci_rows_inserted"] == 1
    with open_db() as conn:
        row = conn.execute(
            "SELECT workflow_name, status FROM ci_results WHERE pr_id = ?",
            (pr_id,),
        ).fetchone()
        assert row["workflow_name"] == "test"
        # status normalized lower
        assert row["status"] in ("success", "completed")


def test_check_run_failure_emits_validation_failed_notify() -> None:
    repo_id, pr_id = _seed_repo_and_pr(pr_number=22)
    fired: list = []
    payload = {
        "action": "completed",
        "check_run": {
            "name": "test", "status": "completed", "conclusion": "failure",
            "html_url": "x",
            "pull_requests": [{"number": 22}],
        },
        "repository": {"full_name": "owner/demo-repo"},
    }
    webhooks.dispatch(event="check_run", payload=payload,
                       notify_fn=lambda **kw: fired.append(kw["event"]))
    assert "validation_failed" in fired


def test_unknown_event_is_noop() -> None:
    init_db()  # log_indexer needs the schema even for a noop event
    out = webhooks.dispatch(event="star", payload={}, notify_fn=lambda **_: None)
    assert out.handled is False
    assert out.summary == {"ignored": True}
