from __future__ import annotations

import os
from pathlib import Path

import yaml

from memory.db import init_db, open_db
from orchestrator import metrics, system_state
from orchestrator.command_queue import enqueue
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.task_manager import create_task


def _seed() -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "demo", "github_owner": "o", "github_repo": "r",
        "local_path": "/tmp/demo", "forbidden_paths": [".env"],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_render_emits_minimum_metric_set() -> None:
    init_db()
    body = metrics.render()
    # Required series even when empty
    for name in ("claude247_tasks_total",
                 "claude247_commands_total",
                 "claude247_prs_total",
                 "claude247_open_alerts",
                 "claude247_log_rows",
                 "claude247_memory_items",
                 "claude247_system_paused",
                 "claude247_allow_remote_writes"):
        assert f"# TYPE {name} gauge" in body, f"missing {name}"


def test_render_counts_match_state() -> None:
    _seed()
    create_task("demo", "g1")
    create_task("demo", "g2")
    enqueue("set_mode", payload={"mode": "running"})
    body = metrics.render()
    # Two queued tasks → status="queued" count == 2
    assert 'claude247_tasks_total{status="queued"} 2' in body
    # One queued command
    assert 'claude247_commands_total{status="queued"} 1' in body


def test_render_shows_system_paused() -> None:
    init_db()
    system_state.pause_system()
    body = metrics.render()
    assert "claude247_system_paused 1" in body


def test_render_text_format_is_well_formed() -> None:
    init_db()
    body = metrics.render()
    # Every non-blank, non-comment line should have two tokens (name + value)
    # or one (just the HELP/TYPE comment).
    for line in body.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.rsplit(" ", 1)
        assert len(parts) == 2, f"malformed metric: {line!r}"
        # value must parse as float
        float(parts[1])
