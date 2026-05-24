from __future__ import annotations

from fastapi.testclient import TestClient

from dashboard.app import create_app
from memory.db import init_db


def test_metrics_route_returns_prometheus_text() -> None:
    init_db()
    client = TestClient(create_app())
    r = client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert "claude247_tasks_total" in r.text
    assert "claude247_system_paused" in r.text
