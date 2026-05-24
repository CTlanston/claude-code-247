from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest
import yaml

from memory.db import init_db, open_db
from orchestrator import notification_manager as nm


def _set_ntfy(topic: str = "test-topic") -> None:
    cfg_dir = Path(os.environ["CLAUDE247_CONFIG_DIR"])
    (cfg_dir / "config.yaml").write_text(yaml.safe_dump({
        "notifications": {"ntfy": {"topic": topic, "server": "https://ntfy.test"}}
    }))


def test_rejects_unknown_event() -> None:
    init_db()
    with pytest.raises(ValueError):
        nm.notify(event="not_an_event", message="x")


def test_log_only_when_no_ntfy_topic() -> None:
    init_db()
    out = nm.notify(event="task_started", message="started",
                     repo_id="demo", task_id="t1")
    assert out.channels == ["log"]
    assert out.delivered is False
    with open_db() as conn:
        rows = list(conn.execute("SELECT channel FROM notifications"))
        assert [r["channel"] for r in rows] == ["log"]


def test_sends_to_ntfy_when_configured() -> None:
    _set_ntfy("topic-x")
    init_db()
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = request.content.decode()
        seen["headers"] = dict(request.headers)
        return httpx.Response(200, text="ok")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = nm.notify(event="approval_required", message="approve PR #1",
                     repo_id="demo", pr_number=1, client=client)
    assert out.channels == ["log", "ntfy"]
    assert out.delivered is True
    assert seen["url"] == "https://ntfy.test/topic-x"
    assert seen["body"] == "approve PR #1"
    assert seen["headers"]["title"].startswith("approval required - demo")
    assert seen["headers"]["priority"] == "5"


def test_dedups_within_window() -> None:
    _set_ntfy("topic")
    init_db()
    sends = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        sends["count"] += 1
        return httpx.Response(200)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    nm.notify(event="task_stuck", message="m", repo_id="r", task_id="t",
               client=client)
    out2 = nm.notify(event="task_stuck", message="m", repo_id="r", task_id="t",
                      client=client)
    assert sends["count"] == 1
    assert out2.deduped is True
    assert out2.channels == ["log"]


def test_different_fingerprint_not_deduped() -> None:
    _set_ntfy("topic")
    init_db()
    sends = {"count": 0}
    client = httpx.Client(transport=httpx.MockTransport(
        lambda req: (sends.__setitem__("count", sends["count"] + 1) or httpx.Response(200)),
    ))
    nm.notify(event="task_stuck", message="m", repo_id="r", task_id="t1", client=client)
    nm.notify(event="task_stuck", message="m", repo_id="r", task_id="t2", client=client)
    assert sends["count"] == 2


def test_ntfy_failure_does_not_raise() -> None:
    _set_ntfy("topic")
    init_db()
    client = httpx.Client(transport=httpx.MockTransport(
        lambda req: httpx.Response(503, text="down"),
    ))
    out = nm.notify(event="task_started", message="x", client=client)
    assert out.delivered is False
    assert out.channels == ["log", "ntfy"]


def test_ntfy_network_error_swallowed() -> None:
    _set_ntfy("topic")
    init_db()

    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=req)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = nm.notify(event="task_started", message="x", client=client)
    assert out.delivered is False
