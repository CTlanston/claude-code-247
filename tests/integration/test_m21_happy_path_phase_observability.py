"""M21-P4 — simulated proof of the no-regression happy path.

Drives the dispatcher end-to-end with the SandboxRunner /
SandboxGithub / all-PASS validators and asserts that:

  - The full M20 path still produces AUTO_MERGE + task.status=merged
  - Each of the M21-P2 instrumented phases lands in worker_exits with
    lifecycle fields populated (status / started_at / finished_at /
    duration_ms)
  - No phase ends up with status=failure

Live equivalent: M20 PR #59 (MERGED) — the most recent on-GitHub
auto-merge proof. We could re-run a live `is_even` task per the
M21-P4 directive, but the day-budget on `auto-evo-playground` is
already exhausted (12 tasks today vs cap 3) and the simulated
integration covers the regression risk for free.
"""
from __future__ import annotations

from pathlib import Path

from memory.db import open_db
from orchestrator.command_queue import enqueue
from orchestrator.dispatcher import run_once
from orchestrator.worker_exits import list_worker_exits

from tests.integration.test_sandbox_e2e import (
    SandboxGithub,
    SandboxRunner,
    _all_pass,
    _flip_writes_on,
    _seed,
)


# Expected to be present after a successful run. (auto_merge is
# only recorded when ruling == AUTO_MERGE — the happy path here.)
EXPECTED_PHASES = {
    "prepare_workspace",
    "worker",
    "validators",
    "risk_score",
    "merge_policy",
    "push",
    "open_pr",
    "auto_merge",
}


def test_happy_path_records_all_instrumented_phases(fake_repo: Path) -> None:
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()

    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "M21-P4 simulated is_even"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)

    assert res.handled and res.status == "succeeded"
    assert res.result["ruling"]["decision"] == "auto_merge"
    assert gh.merge_calls, "happy path must call merge_pr"
    with open_db() as conn:
        task = conn.execute(
            "SELECT status FROM tasks WHERE id = ?",
            (res.result["task_id"],),
        ).fetchone()
        assert task["status"] == "merged"

    # M21-P2 — every instrumented phase landed
    rows = list_worker_exits(task_id=res.result["task_id"])
    found_phases = {r.phase for r in rows}
    missing = EXPECTED_PHASES - found_phases
    assert not missing, (
        f"missing phase rows: {sorted(missing)}; "
        f"got: {sorted(found_phases)}"
    )
    # And no phase failed
    failures = [r for r in rows if r.status == "failure"]
    assert failures == [], (
        f"happy path produced unexpected failure rows: {[r.phase for r in failures]}"
    )
    # Lifecycle fields populated on each instrumented row
    for r in rows:
        if r.phase in EXPECTED_PHASES:
            assert r.status in ("success", "skipped"), \
                f"phase {r.phase} has status={r.status}"
            assert r.started_at is not None, f"phase {r.phase} missing started_at"
            assert r.finished_at is not None, f"phase {r.phase} missing finished_at"
            assert r.duration_ms is not None and r.duration_ms >= 0


def test_happy_path_validators_phase_metadata_carries_verdicts(
    fake_repo: Path,
) -> None:
    """The validators row should carry the final verdict + per-validator
    labels in metadata so `claude247 task-phases` can show them
    inline without joining validator_results."""
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()
    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "validators metadata"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)

    rows = list_worker_exits(task_id=res.result["task_id"])
    val_row = next(r for r in rows if r.phase == "validators")
    assert val_row.payload.get("final_verdict") == "PASS"
    verdicts = val_row.payload.get("verdicts") or []
    assert len(verdicts) == 2
    assert all(v.get("verdict") == "PASS" for v in verdicts)


def test_happy_path_risk_score_phase_metadata_carries_score(
    fake_repo: Path,
) -> None:
    """The risk_score row should carry the computed score + level so
    operators can see "why" without re-running compute_risk."""
    _seed(fake_repo, auto_merge=True)
    _flip_writes_on()
    runner = SandboxRunner()
    gh = SandboxGithub()
    enqueue("start_task", repo_id="sandbox",
            payload={"repo_id": "sandbox", "goal": "risk metadata"})
    res = run_once(runner=runner, validator_fn=_all_pass, github=gh,
                    notify_fn=lambda **_: None, poll_ci=False)
    rows = list_worker_exits(task_id=res.result["task_id"])
    risk_row = next(r for r in rows if r.phase == "risk_score")
    assert "risk_score" in risk_row.payload
    assert risk_row.payload.get("risk_level") in ("low", "medium", "high")
    assert isinstance(risk_row.payload.get("files_changed"), int)
