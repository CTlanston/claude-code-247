"""M22b — `/status-board` and `/status-board.json` dashboard routes."""
from __future__ import annotations

from fastapi.testclient import TestClient

from dashboard.app import create_app
from gateway import status_board


def _stub_probes(monkeypatch) -> None:
    monkeypatch.setattr(status_board, "_launchd_loaded_count", lambda: 4)
    monkeypatch.setattr(status_board, "_dispatcher_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_dashboard_health", lambda timeout=2.0: "healthy")
    monkeypatch.setattr(status_board, "_notifier_health", lambda: "healthy")
    monkeypatch.setattr(status_board, "_doctor_health", lambda: "ok")


def test_status_board_html_renders(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    client = TestClient(create_app())
    r = client.get("/status-board")
    assert r.status_code == 200, r.text
    body = r.text
    for label in (
        "GA status", "Soak progress", "Runtime health",
        "Queue", "Recent signals", "GA gates",
    ):
        assert label in body, f"missing {label!r}"


def test_status_board_json_endpoint(monkeypatch) -> None:
    _stub_probes(monkeypatch)
    client = TestClient(create_app())
    r = client.get("/status-board.json")
    assert r.status_code == 200
    payload = r.json()
    for key in (
        "generated_at", "release_state", "soak", "runtime_health",
        "queue", "signals", "ga_gates",
    ):
        assert key in payload
