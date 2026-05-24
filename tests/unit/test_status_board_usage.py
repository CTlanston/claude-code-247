"""M22b — Usage stats aggregation for the watchdog board."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from click.testing import CliRunner

from gateway import status_board
from gateway.cli import cli
from gateway.status_board import collect_usage
from memory.db import init_db, open_db
from orchestrator.ids import make_id, utc_now_iso


_FIXED_NOW = datetime(2026, 5, 25, 21, 46, 0, tzinfo=timezone.utc)


def _stub_probes(monkeypatch) -> None:
    monkeypatch.setattr(status_board, "_launchd_loaded_count", lambda: 4)
    monkeypatch.setattr(status_board, "_dispatcher_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_dashboard_health", lambda timeout=2.0: "healthy")
    monkeypatch.setattr(status_board, "_notifier_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_doctor_health", lambda: "ok")


def _seed_task(conn) -> str:
    """Insert a minimal repo + task row so the runs FK is satisfied."""
    now = utc_now_iso()
    conn.execute(
        "INSERT INTO repos (id, name, github_owner, github_repo, local_path, "
        "config_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ("demo", "demo", "owner", "demo", "/tmp/demo", "{}", now, now),
    )
    tid = make_id("task")
    conn.execute(
        "INSERT INTO tasks (id, repo_id, goal, source, status, created_at, "
        "updated_at, payload_json) VALUES (?,?,?,?,?,?,?,?)",
        (tid, "demo", "g", "cli", "merged", now, now, "{}"),
    )
    return tid


def _seed_run(conn, *, task_id: str, role: str, auth_mode: str,
              started_at: str, finished_at: str | None,
              cost: float | None) -> None:
    conn.execute(
        "INSERT INTO runs (id, task_id, role, started_at, finished_at, "
        "exit_code, duration_ms, cost_estimate, auth_mode, payload_json) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (make_id("run"), task_id, role, started_at, finished_at,
         0 if finished_at else None, 1000, cost, auth_mode, "{}"),
    )


def test_usage_when_runs_table_is_empty() -> None:
    init_db()
    u = collect_usage(now=_FIXED_NOW)
    assert u.runs_total == 0
    assert u.runs_today == 0
    assert u.runs_last_hour == 0
    assert u.active_workers == 0
    assert u.by_role == {}
    assert u.by_auth_mode == {}
    assert u.estimated_cost_today_usd == 0.0
    assert u.estimated_cost_total_usd == 0.0
    assert "idle" in u.note


def test_usage_counts_by_role_and_auth_mode() -> None:
    init_db()
    with open_db() as conn:
        tid = _seed_task(conn)
        # Today, finished, BEFORE the 1-hour cutoff (now=21:46, cutoff=20:46).
        _seed_run(conn, task_id=tid, role="planner",
                  auth_mode="local_claude_code",
                  started_at="2026-05-25T05:00:00Z",
                  finished_at="2026-05-25T05:01:00Z", cost=None)
        _seed_run(conn, task_id=tid, role="coder",
                  auth_mode="local_claude_code",
                  started_at="2026-05-25T05:10:00Z",
                  finished_at="2026-05-25T05:12:00Z", cost=None)
        # Today, last hour, anthropic_api with cost.
        _seed_run(conn, task_id=tid, role="validator",
                  auth_mode="openai",
                  started_at="2026-05-25T21:40:00Z",
                  finished_at="2026-05-25T21:41:00Z", cost=0.0250)
        # Today, last hour, still running (active worker).
        _seed_run(conn, task_id=tid, role="reviewer",
                  auth_mode="local_claude_code",
                  started_at="2026-05-25T21:45:30Z",
                  finished_at=None, cost=None)
        # Older — not today, not last hour.
        _seed_run(conn, task_id=tid, role="planner",
                  auth_mode="local_claude_code",
                  started_at="2026-05-24T10:00:00Z",
                  finished_at="2026-05-24T10:01:00Z", cost=None)

    u = collect_usage(now=_FIXED_NOW)
    assert u.runs_total == 5
    assert u.runs_today == 4
    assert u.runs_last_hour == 2  # 21:40 and 21:45 are within the last hour
    assert u.active_workers == 1
    assert u.by_role == {"planner": 2, "coder": 1, "validator": 1, "reviewer": 1}
    assert u.by_auth_mode == {"local_claude_code": 4, "openai": 1}
    assert u.estimated_cost_total_usd == 0.025
    # Today's cost aggregates from ``budgets``, which we didn't seed →
    # remains 0 — that's correct: ``runs.cost_estimate`` flows into
    # ``budgets.estimated_api_cost`` through a different code path.
    assert u.estimated_cost_today_usd == 0.0
    assert "subscription" in u.note or "local" in u.note


def test_usage_today_cost_reads_from_budgets() -> None:
    init_db()
    with open_db() as conn:
        conn.execute(
            "INSERT INTO budgets (id, repo_id, date, estimated_api_cost, updated_at) "
            "VALUES (?,?,?,?,?)",
            (make_id("bud"), "demo", "2026-05-25", 1.2345, utc_now_iso()),
        )
        conn.execute(
            "INSERT INTO budgets (id, repo_id, date, estimated_api_cost, updated_at) "
            "VALUES (?,?,?,?,?)",
            (make_id("bud"), "other", "2026-05-25", 0.5000, utc_now_iso()),
        )
        # Yesterday's bucket — must be excluded from "today".
        conn.execute(
            "INSERT INTO budgets (id, repo_id, date, estimated_api_cost, updated_at) "
            "VALUES (?,?,?,?,?)",
            (make_id("bud"), "demo", "2026-05-24", 99.99, utc_now_iso()),
        )
    u = collect_usage(now=_FIXED_NOW)
    assert u.estimated_cost_today_usd == round(1.2345 + 0.5000, 4)


def test_status_board_json_now_includes_usage(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    assert r.exit_code == 0, r.output
    payload = json.loads(r.output)
    assert "usage" in payload
    u = payload["usage"]
    for key in (
        "runs_total", "runs_today", "runs_last_hour", "active_workers",
        "by_role", "by_auth_mode",
        "estimated_cost_today_usd", "estimated_cost_total_usd", "note",
    ):
        assert key in u, f"missing usage.{key}"


def test_plain_output_includes_usage_section(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--plain", "--t0", "2026-05-24T21:46Z"],
    )
    assert r.exit_code == 0, r.output
    assert "Usage" in r.output
    assert "runs total:" in r.output
    assert "active workers:" in r.output


def test_markdown_includes_usage_table(monkeypatch, tmp_path) -> None:
    _stub_probes(monkeypatch)
    init_db()
    out = tmp_path / "WATCHDOG.md"
    r = CliRunner().invoke(
        cli, ["status-board", "--t0", "2026-05-24T21:46Z",
              "--write-md", str(out)],
    )
    assert r.exit_code == 0, r.output
    body = out.read_text(encoding="utf-8")
    assert "## Usage" in body
    assert "| runs total |" in body
    assert "| active workers |" in body
