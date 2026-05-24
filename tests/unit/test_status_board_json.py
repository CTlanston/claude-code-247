"""M22b — JSON shape contract for `claude247 status-board --json`."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from click.testing import CliRunner

from gateway import status_board
from gateway.cli import cli
from memory.db import init_db


_T0 = datetime(2026, 5, 24, 21, 46, 0, tzinfo=timezone.utc)
_NOW = datetime(2026, 5, 25, 21, 46, 0, tzinfo=timezone.utc)


def _stub_probes(monkeypatch) -> None:
    monkeypatch.setattr(status_board, "_launchd_loaded_count", lambda: 4)
    monkeypatch.setattr(status_board, "_dispatcher_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_dashboard_health", lambda timeout=2.0: "healthy")
    monkeypatch.setattr(status_board, "_notifier_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_doctor_health", lambda: "ok")
    monkeypatch.setattr(status_board, "_now_utc", lambda: _NOW)


def test_json_top_level_keys(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    assert r.exit_code == 0, r.output
    payload = json.loads(r.output)
    for key in (
        "generated_at", "release_state", "soak",
        "runtime_health", "queue", "signals", "ga_gates",
    ):
        assert key in payload, f"missing top-level key {key!r}"


def test_json_release_state_shape(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    payload = json.loads(r.output)
    rel = payload["release_state"]
    for key in (
        "main_sha", "implementation_branch_sha", "ga_tag_exists",
        "latest_release", "ga_status",
    ):
        assert key in rel, f"missing release_state.{key}"
    assert isinstance(rel["ga_tag_exists"], bool)
    assert rel["ga_status"] in {"GO", "NO-GO", "READY", "SHIPPED"}


def test_json_soak_shape(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    payload = json.loads(r.output)
    s = payload["soak"]
    for key in (
        "t0", "elapsed_seconds", "required_seconds",
        "progress_percent", "result", "earliest_full_check",
    ):
        assert key in s, f"missing soak.{key}"
    assert s["required_seconds"] == 86400
    assert s["result"] in {"PASS", "PARTIAL", "FAIL", "UNKNOWN"}


def test_json_runtime_health_shape(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    payload = json.loads(r.output)
    rh = payload["runtime_health"]
    for key in (
        "launchd_loaded", "launchd_expected",
        "dispatcher", "dashboard", "notifier", "doctor",
    ):
        assert key in rh, f"missing runtime_health.{key}"
    assert rh["launchd_expected"] == 4


def test_json_queue_shape(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    payload = json.loads(r.output)
    q = payload["queue"]
    for key in (
        "repos_enabled", "active_tasks", "stuck_tasks",
        "need_approval", "orphan_commands", "pending_commands",
    ):
        assert key in q, f"missing queue.{key}"
        assert isinstance(q[key], int)


def test_json_signals_shape(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    payload = json.loads(r.output)
    sig = payload["signals"]
    for key in (
        "new_critical_errors", "known_historical_errors",
        "alert_storm", "budget_sane", "logs_searchable",
    ):
        assert key in sig, f"missing signals.{key}"
    assert isinstance(sig["alert_storm"], bool)
    assert isinstance(sig["budget_sane"], bool)
    assert isinstance(sig["logs_searchable"], bool)


def test_json_ga_gates_shape(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    init_db()
    r = CliRunner().invoke(
        cli, ["status-board", "--json", "--t0", "2026-05-24T21:46Z"],
    )
    payload = json.loads(r.output)
    g = payload["ga_gates"]
    for key in ("passed", "total", "blocked", "recommendation"):
        assert key in g, f"missing ga_gates.{key}"
    assert isinstance(g["blocked"], list)
    assert isinstance(g["passed"], int)
    assert isinstance(g["total"], int)
