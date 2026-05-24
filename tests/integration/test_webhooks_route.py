from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from dashboard.app import create_app
from memory.db import init_db


def _set_secret(secret: str) -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "github": {"webhook_secret": secret},
    }))


def _sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_webhook_503_when_secret_unset() -> None:
    init_db()
    client = TestClient(create_app())
    r = client.post("/webhooks/github",
                     content=b'{"x":1}',
                     headers={"X-GitHub-Event": "ping"})
    assert r.status_code == 503


def test_webhook_401_on_bad_signature() -> None:
    init_db()
    _set_secret("topsecret")
    client = TestClient(create_app())
    r = client.post("/webhooks/github",
                     content=b'{"x":1}',
                     headers={"X-GitHub-Event": "ping",
                               "X-Hub-Signature-256": "sha256=bad"})
    assert r.status_code == 401


def test_webhook_400_on_bad_json() -> None:
    init_db()
    _set_secret("topsecret")
    body = b'{not valid json'
    sig = _sign(body, "topsecret")
    client = TestClient(create_app())
    r = client.post("/webhooks/github",
                     content=body,
                     headers={"X-GitHub-Event": "ping",
                               "X-Hub-Signature-256": sig})
    assert r.status_code == 400


def test_webhook_accepts_unknown_event_as_noop() -> None:
    init_db()
    _set_secret("topsecret")
    body = json.dumps({"action": "x"}).encode()
    sig = _sign(body, "topsecret")
    client = TestClient(create_app())
    r = client.post("/webhooks/github",
                     content=body,
                     headers={"X-GitHub-Event": "ping",
                               "X-Hub-Signature-256": sig})
    assert r.status_code == 200
    out = r.json()
    assert out["handled"] is False
    assert out["event"] == "ping"


def test_webhook_pull_request_merged_persists_state() -> None:
    """Full route test: signed PR-merged event lands a state change."""
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "owner", "github_repo": "demo-repo",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
    }]}))
    init_db()
    from memory.db import open_db
    from orchestrator.ids import make_id, utc_now_iso
    from orchestrator.repo_registry import parse_registry, sync_to_db
    sync_to_db(parse_registry(repos_path.read_text()))
    now = utc_now_iso()
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
            (make_id("pr"), "demo", tid, 33, "b", "t",
             "https://github.com/owner/demo-repo/pull/33", "open",
             "approved", now, now),
        )

    _set_secret("super")
    payload = {
        "action": "closed",
        "pull_request": {"number": 33, "merged": True, "state": "closed",
                          "merged_at": "2026-05-24T15:00:00Z"},
        "repository": {"full_name": "owner/demo-repo"},
    }
    body = json.dumps(payload).encode()
    sig = _sign(body, "super")
    client = TestClient(create_app())
    r = client.post("/webhooks/github",
                     content=body,
                     headers={"X-GitHub-Event": "pull_request",
                               "X-Hub-Signature-256": sig,
                               "Content-Type": "application/json"})
    assert r.status_code == 200
    body_resp = r.json()
    assert body_resp["handled"] is True
    with open_db() as conn:
        row = conn.execute("SELECT state FROM prs WHERE pr_number = ?", (33,)).fetchone()
        assert row["state"] == "merged"
