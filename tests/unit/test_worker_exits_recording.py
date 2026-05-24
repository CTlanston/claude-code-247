"""M21-P2 — record_phase() context manager.

Behavior contract:
  - on normal exit -> status=success, classification=success, exit_code=0
  - on exception -> status=failure, error_type=class, error_message=str(exc),
    exit_code=-1, classification picked by heuristic; exception re-raised
  - on rec.skip(reason) -> status=skipped, metadata contains skip_reason
  - on rec.fail(...) -> status=failure with explicit classification
  - duration_ms reflects elapsed time
  - row is written even when an exception propagates
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from memory.db import init_db
from orchestrator.worker_exits import (
    list_worker_exits,
    record_phase,
)


def test_normal_exit_records_success(tmp_path: Path) -> None:
    init_db()
    with record_phase(task_id="t1", repo_id="r1", phase="prepare_workspace"):
        time.sleep(0.01)
    rows = list_worker_exits(task_id="t1")
    assert len(rows) == 1
    r = rows[0]
    assert r.status == "success"
    assert r.classification == "success"
    assert r.exit_code == 0
    assert r.started_at is not None
    assert r.finished_at is not None
    assert r.duration_ms is not None and r.duration_ms >= 0


def test_exception_records_failure_and_re_raises(tmp_path: Path) -> None:
    init_db()
    with pytest.raises(ValueError, match="boom"):
        with record_phase(task_id="t2", repo_id="r2", phase="open_pr"):
            raise ValueError("boom: PR creation failed")
    rows = list_worker_exits(task_id="t2")
    assert len(rows) == 1
    r = rows[0]
    assert r.status == "failure"
    assert r.error_type == "ValueError"
    assert "boom" in (r.error_message or "")
    assert r.exit_code == -1
    # Classification falls back to unknown_failure for generic ValueError
    assert r.classification in (
        "unknown_failure", "github_failure", "validator_failure",
    )


def test_caller_can_set_metadata(tmp_path: Path) -> None:
    init_db()
    with record_phase(task_id="t3", repo_id="r3", phase="risk_score") as rec:
        rec.metadata["risk_score"] = 12
        rec.metadata["risk_level"] = "low"
    rows = list_worker_exits(task_id="t3")
    assert rows[0].payload["risk_score"] == 12
    assert rows[0].payload["risk_level"] == "low"


def test_caller_can_skip(tmp_path: Path) -> None:
    init_db()
    with record_phase(task_id="t4", repo_id="r4", phase="auto_merge") as rec:
        rec.skip("ruling=waiting_approval; nothing to merge")
    rows = list_worker_exits(task_id="t4")
    r = rows[0]
    assert r.status == "skipped"
    assert r.payload["skip_reason"] == "ruling=waiting_approval; nothing to merge"
    assert r.exit_code == 0


def test_caller_can_fail_explicitly(tmp_path: Path) -> None:
    init_db()
    with record_phase(task_id="t5", repo_id="r5", phase="merge_policy") as rec:
        rec.fail(classification="merge_policy_block",
                 error_type="MergeBlocked",
                 error_message="secret_scanner: github_token detected")
    rows = list_worker_exits(task_id="t5")
    r = rows[0]
    assert r.status == "failure"
    assert r.classification == "merge_policy_block"
    assert r.error_type == "MergeBlocked"


def test_db_failure_inside_emit_doesnt_break_caller(tmp_path: Path,
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    """Best-effort recording: if the DB write itself raises, the
    record_phase block must still let the original code's return
    value flow through (or propagate the original exception)."""
    import orchestrator.worker_exits as we
    def boom_emit(*a, **kw):  # noqa: ARG001
        raise RuntimeError("simulated DB outage")
    monkeypatch.setattr(we, "_emit_phase_row", boom_emit)
    init_db()
    # Success path: no exception escapes
    with record_phase(task_id="t6", repo_id="r6", phase="tests"):
        pass
    # Failure path: original exception propagates, DB-write error is swallowed
    with pytest.raises(KeyError):
        with record_phase(task_id="t7", repo_id="r7", phase="push"):
            raise KeyError("upstream")


def test_record_phase_classification_heuristic_for_known_phase(
    tmp_path: Path,
) -> None:
    init_db()
    # When phase="tests" and an exception fires, classify_failure with
    # the synthetic stderr_tail should land on test_failure (or
    # unknown_failure) — never raise.
    with pytest.raises(RuntimeError):
        with record_phase(task_id="t8", repo_id="r8", phase="tests"):
            raise RuntimeError("pytest crashed")
    rows = list_worker_exits(task_id="t8")
    assert rows[0].classification in (
        "test_failure", "unknown_failure",
    )
