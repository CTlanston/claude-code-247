from __future__ import annotations

import re

from orchestrator.ids import make_id, ulid, utc_now_iso


def test_ulid_length_and_alphabet() -> None:
    u = ulid()
    assert len(u) == 26
    assert re.fullmatch(r"[0-9A-HJKMNP-TV-Z]+", u), u


def test_make_id_carries_prefix() -> None:
    tid = make_id("task")
    assert tid.startswith("task_")
    assert len(tid) == 5 + 26


def test_ids_are_unique_across_calls() -> None:
    ids = {make_id("x") for _ in range(64)}
    assert len(ids) == 64


def test_utc_now_iso_format() -> None:
    s = utc_now_iso()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", s), s
