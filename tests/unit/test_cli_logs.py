from __future__ import annotations

import json

from click.testing import CliRunner

from gateway.cli import cli
from memory.db import init_db
from orchestrator import log_indexer


def test_logs_tail_empty() -> None:
    init_db()
    r = CliRunner().invoke(cli, ["logs", "tail"])
    assert r.exit_code == 0
    assert "no logs" in r.output.lower()


def test_logs_tail_plain_format() -> None:
    init_db()
    log_indexer.write(level="info", component="orch", message="started")
    log_indexer.write(level="error", component="run", message="boom",
                       repo_id="demo", task_id="task_abc")
    r = CliRunner().invoke(cli, ["logs", "tail", "--limit", "10"])
    assert r.exit_code == 0
    assert "started" in r.output
    assert "boom" in r.output
    # Mobile-tight: timestamp + level + component + scope + message in one line
    lines = [ln for ln in r.output.strip().splitlines() if ln]
    assert all(len(ln) < 200 for ln in lines)


def test_logs_search_text_filters() -> None:
    init_db()
    log_indexer.write(level="info", component="x", message="validator failed once")
    log_indexer.write(level="info", component="x", message="all green")
    r = CliRunner().invoke(cli, ["logs", "search", "validator"])
    assert r.exit_code == 0
    assert "validator failed" in r.output
    assert "all green" not in r.output


def test_logs_search_json_shape() -> None:
    init_db()
    log_indexer.write(level="info", component="x", message="hi", repo_id="demo")
    r = CliRunner().invoke(cli, ["logs", "search", "--json"])
    assert r.exit_code == 0
    rows = json.loads(r.output)
    assert rows[0]["message"] == "hi"
    assert rows[0]["repo"] == "demo"
