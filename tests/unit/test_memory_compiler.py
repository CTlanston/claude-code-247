from __future__ import annotations

import os
from pathlib import Path

import yaml

from memory.compiler import compile_repo, retrieve_for_planning
from memory.db import init_db, open_db
from memory.repo_memory import AgentMemory
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db


def _seed_repo(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": str(fake_repo), "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def _add_failed_task(repo_id: str, goal: str) -> str:
    now = utc_now_iso()
    tid = make_id("task")
    with open_db() as conn:
        conn.execute("INSERT INTO tasks (id, repo_id, goal, source, status, "
                     "created_at, updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
                     (tid, repo_id, goal, "cli", "failed", now, now, "{}"))
    return tid


def _add_validator_fail(task_id: str, validator: str, summary: str) -> None:
    now = utc_now_iso()
    with open_db() as conn:
        conn.execute("INSERT INTO validator_results (id, task_id, validator, verdict, "
                     "confidence, summary, created_at) VALUES (?,?,?,?,?,?,?)",
                     (make_id("v"), task_id, validator, "FAIL", 0.4, summary, now))


def _add_decision(repo_id: str, topic: str, decision: str, rationale: str) -> None:
    now = utc_now_iso()
    with open_db() as conn:
        conn.execute("INSERT INTO decisions (id, repo_id, topic, decided_by, decision, "
                     "rationale, created_at) VALUES (?,?,?,?,?,?,?)",
                     (make_id("dec"), repo_id, topic, "system", decision, rationale, now))


def test_compile_with_no_history_notes_empty(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    from orchestrator.repo_registry import load_registry
    r = compile_repo(load_registry()[0], window="daily")
    assert r.memory_items_added == 0
    assert any("no new" in n for n in r.notes)


def test_compile_writes_failures_section(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    _add_failed_task("demo", "first failure goal")
    _add_failed_task("demo", "second failure goal")
    from orchestrator.repo_registry import load_registry
    r = compile_repo(load_registry()[0], window="daily")
    assert r.memory_items_added == 2
    mem = AgentMemory(repo_path=fake_repo)
    body = mem.read("FAILURES")
    assert "first failure goal" in body
    assert "second failure goal" in body
    assert "## daily digest" in body


def test_compile_writes_review_lessons(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    tid = _add_failed_task("demo", "task with bad validator")
    _add_validator_fail(tid, "gemini", "judge said no")
    from orchestrator.repo_registry import load_registry
    r = compile_repo(load_registry()[0], window="daily")
    assert r.memory_items_added >= 2  # failure + review
    mem = AgentMemory(repo_path=fake_repo)
    body = mem.read("REVIEW_LESSONS")
    assert "gemini" in body
    assert "judge said no" in body


def test_compile_writes_decisions(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    _add_decision("demo", "Schema migration", "rollback",
                   "we hit unique key conflicts")
    from orchestrator.repo_registry import load_registry
    r = compile_repo(load_registry()[0], window="daily")
    assert r.memory_items_added == 1
    mem = AgentMemory(repo_path=fake_repo)
    body = mem.read("DECISIONS")
    assert "Schema migration" in body
    assert "rollback" in body


def test_retrieve_for_planning_returns_relevant_items(fake_repo: Path) -> None:
    _seed_repo(fake_repo)
    tid = _add_failed_task("demo", "fix auth flow for OIDC")
    _add_validator_fail(tid, "gemini", "auth scopes mismatch")
    from orchestrator.repo_registry import load_registry
    compile_repo(load_registry()[0], window="daily")
    hits = retrieve_for_planning(repo_id="demo", goal="auth")
    assert hits, "expected at least one hit for 'auth'"
    assert any("auth" in h.text.lower() for h in hits)
