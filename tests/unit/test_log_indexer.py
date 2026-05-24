from __future__ import annotations

import pytest

from memory.db import init_db
from orchestrator import log_indexer


def test_write_rejects_bad_level() -> None:
    init_db()
    with pytest.raises(ValueError):
        log_indexer.write(level="oops", component="x", message="y")


def test_write_and_tail() -> None:
    init_db()
    log_indexer.write(level="info", component="orchestrator", message="started")
    log_indexer.write(level="error", component="runner", message="boom",
                       repo_id="demo", task_id="task_x")
    rows = log_indexer.tail(limit=10)
    assert len(rows) == 2
    # newest first
    assert rows[0].message == "boom"


def test_search_text_uses_fts() -> None:
    init_db()
    log_indexer.write(level="info", component="x", message="validator failed for task A")
    log_indexer.write(level="info", component="x", message="all green for B")
    hits = log_indexer.search(text="validator")
    assert len(hits) == 1
    assert "validator failed" in hits[0].message


def test_search_filters_combine() -> None:
    init_db()
    log_indexer.write(level="info", component="runner", message="r1", repo_id="alpha")
    log_indexer.write(level="error", component="runner", message="r2", repo_id="beta")
    log_indexer.write(level="info", component="orchestrator", message="o1", repo_id="alpha")
    hits = log_indexer.search(level="info", repo_id="alpha")
    assert {h.message for h in hits} == {"r1", "o1"}
