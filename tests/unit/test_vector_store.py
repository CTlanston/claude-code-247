from __future__ import annotations

from memory.db import init_db
from memory.vector_store import MemoryItem, _SqliteBackend


def test_add_and_search_keyword_match() -> None:
    init_db()
    s = _SqliteBackend()
    s.add(MemoryItem(repo_id="r", item_type="failure",
                      text="validator failed on timeouts",
                      metadata={"task_id": "t1"}))
    s.add(MemoryItem(repo_id="r", item_type="failure",
                      text="merge succeeded happily",
                      metadata={"task_id": "t2"}))
    hits = s.search("timeouts", repo_id="r")
    assert len(hits) == 1
    assert "timeouts" in hits[0].text


def test_search_filters_by_type() -> None:
    init_db()
    s = _SqliteBackend()
    s.add(MemoryItem(repo_id="r", item_type="failure", text="bad ci",
                      metadata={}))
    s.add(MemoryItem(repo_id="r", item_type="decision", text="bad design",
                      metadata={}))
    hits = s.search("bad", repo_id="r", item_type="decision")
    assert len(hits) == 1
    assert hits[0].item_type == "decision"


def test_search_scoped_to_repo() -> None:
    init_db()
    s = _SqliteBackend()
    s.add(MemoryItem(repo_id="alpha", item_type="failure",
                      text="auth failure A", metadata={}))
    s.add(MemoryItem(repo_id="beta", item_type="failure",
                      text="auth failure B", metadata={}))
    hits = s.search("auth", repo_id="alpha")
    assert len(hits) == 1
    assert hits[0].repo_id == "alpha"


def test_count() -> None:
    init_db()
    s = _SqliteBackend()
    s.add(MemoryItem(repo_id="r", item_type="x", text="a", metadata={}))
    s.add(MemoryItem(repo_id="r", item_type="x", text="b", metadata={}))
    s.add(MemoryItem(repo_id="r2", item_type="y", text="c", metadata={}))
    assert s.count() == 3
    assert s.count(repo_id="r") == 2
    assert s.count(item_type="x") == 2
    assert s.count(repo_id="r", item_type="x") == 2
