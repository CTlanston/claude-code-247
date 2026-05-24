from __future__ import annotations

import json
import os
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from dashboard.app import create_app
from memory.db import init_db, open_db
from orchestrator import alert_deduper, budget_manager, log_indexer
from orchestrator.command_queue import list_commands
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed_repo() -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def _seed_pr_with_risk() -> tuple[str, int]:
    _seed_repo()
    now = utc_now_iso()
    with open_db() as conn:
        tid = make_id("task")
        conn.execute("INSERT INTO tasks (id, repo_id, goal, source, status, "
                     "created_at, updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
                     (tid, "demo", "do thing", "cli", "pr_created", now, now, "{}"))
        pid = make_id("pr")
        conn.execute("INSERT INTO prs (id, repo_id, task_id, pr_number, branch, "
                     "title, url, state, approval_state, risk_score, created_at, updated_at) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                     (pid, "demo", tid, 7, "agent/demo/x/y", "test PR",
                      "https://github.com/o/r/pull/7", "open", "required", 25, now, now))
        rid = make_id("rs")
        conn.execute("INSERT INTO risk_scores (id, task_id, pr_id, score, level, "
                     "factors_json, created_at) VALUES (?,?,?,?,?,?,?)",
                     (rid, tid, pid, 25, "low",
                      json.dumps([{"name": "files_touched_per_3", "weight": 3, "reason": "ok"}]),
                      now))
        vid = make_id("v")
        conn.execute("INSERT INTO validator_results (id, task_id, validator, verdict, "
                     "confidence, summary, created_at) VALUES (?,?,?,?,?,?,?)",
                     (vid, tid, "gemini", "PASS", 0.92, "ok", now))
        conn.execute("INSERT INTO validator_results (id, task_id, validator, verdict, "
                     "confidence, summary, created_at) VALUES (?,?,?,?,?,?,?)",
                     (make_id("v"), tid, "openai", "PASS", 0.9, "ok", now))
    return "demo", 7


def test_overview_includes_alert_count() -> None:
    _seed_repo()
    alert_deduper.emit(alert_type="t", severity="warn", message="hi")
    client = TestClient(create_app())
    r = client.get("/")
    assert "Open alerts" in r.text
    # the value should appear in the row
    assert ">1<" in r.text or ">1</a>" in r.text


def test_repo_detail_renders_budget_and_lists() -> None:
    _seed_repo()
    budget_manager.increment("demo", counter="tasks_count", by=2)
    client = TestClient(create_app())
    r = client.get("/repos/demo")
    assert r.status_code == 200
    assert "demo" in r.text
    assert "Today's budget" in r.text
    # the seeded tasks count of 2 should render
    assert ">2<" in r.text


def test_repo_detail_404() -> None:
    init_db()
    client = TestClient(create_app())
    r = client.get("/repos/nope")
    assert r.status_code == 404


def test_prs_page_lists_seeded_pr() -> None:
    repo, num = _seed_pr_with_risk()
    client = TestClient(create_app())
    r = client.get("/prs")
    assert r.status_code == 200
    assert f"#{num}" in r.text


def test_pr_detail_shows_risk_and_validators() -> None:
    repo, num = _seed_pr_with_risk()
    client = TestClient(create_app())
    r = client.get(f"/prs/{repo}/{num}")
    assert r.status_code == 200
    assert "Score <strong>25" in r.text
    assert "gemini" in r.text and "openai" in r.text
    assert "Approve merge" in r.text


def test_pr_approve_enqueues_command() -> None:
    repo, num = _seed_pr_with_risk()
    client = TestClient(create_app())
    r = client.post(f"/prs/{repo}/{num}/approve", follow_redirects=False)
    assert r.status_code == 303
    cmds = list_commands()
    assert any(c.command_type == "approve_merge" and c.source == "dashboard"
               and c.repo_id == repo and c.pr_number == num for c in cmds)


def test_pr_reject_enqueues_with_reason() -> None:
    repo, num = _seed_pr_with_risk()
    client = TestClient(create_app())
    r = client.post(f"/prs/{repo}/{num}/reject", data={"reason": "not yet"},
                     follow_redirects=False)
    assert r.status_code == 303
    cmds = list_commands()
    rej = next(c for c in cmds if c.command_type == "reject_merge")
    assert rej.payload == {"reason": "not yet"}


def test_budgets_page_lists_repos() -> None:
    _seed_repo()
    client = TestClient(create_app())
    r = client.get("/budgets")
    assert r.status_code == 200
    assert "demo" in r.text


def test_logs_page_filter_form_renders() -> None:
    init_db()
    log_indexer.write(level="info", component="x", message="hello world")
    log_indexer.write(level="error", component="y", message="bad thing happened")
    client = TestClient(create_app())
    r = client.get("/logs?q=bad")
    assert r.status_code == 200
    assert "bad thing" in r.text
    assert "hello world" not in r.text


def test_alerts_page_lists_and_ack() -> None:
    init_db()
    a = alert_deduper.emit(alert_type="task_stuck", severity="warn", message="x")
    client = TestClient(create_app())
    r = client.get("/alerts")
    assert r.status_code == 200
    assert "task_stuck" in r.text
    r2 = client.post(f"/alerts/{a.id}/ack", follow_redirects=False)
    assert r2.status_code == 303
    # acked alert no longer in /alerts
    r3 = client.get("/alerts")
    assert "task_stuck" not in r3.text


def test_memory_page_empty_state() -> None:
    init_db()
    client = TestClient(create_app())
    r = client.get("/memory")
    assert r.status_code == 200
    assert "M9" in r.text


def test_settings_page_shows_config() -> None:
    init_db()
    client = TestClient(create_app())
    r = client.get("/settings")
    assert r.status_code == 200
    assert "allow_remote_writes" in r.text
    assert "local_claude_code" in r.text


def test_commands_page_lists_entries() -> None:
    init_db()
    from orchestrator.command_queue import enqueue
    enqueue("start_task", repo_id="demo", payload={"goal": "x"})
    client = TestClient(create_app())
    r = client.get("/commands")
    assert "start_task" in r.text
