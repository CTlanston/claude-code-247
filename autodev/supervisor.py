"""Supervisor — the AutoDev v3 outer loop.

Two invocation modes:

  python3 -m autodev.supervisor --once          # one cycle, exit
  python3 -m autodev.supervisor --supervisor    # long-running

The one-cycle behaviour:

  1. Load state.
  2. Process commands.
  3. If paused → report + exit 0.
  4. If critical blocker → report + exit 0.
  5. Decide next action via RecoveryManager.
  6. Run inner engine (or dry-run stub).
  7. Update state + reports.
  8. Exit.

The long-running supervisor wraps step 1-8 in a loop with
AUTODEV_INTERVAL_SECONDS sleep between cycles. Ctrl-C is honoured.
"""
from __future__ import annotations

import argparse
import os
import signal
import sys
import time
from pathlib import Path
from typing import Optional

from .backlog_manager import BacklogManager, BacklogTask
from .command_manager import CommandManager, CommandResult
from .cost_policy import CostPolicy
from .inner_engine import EngineResult, InnerEngine
from .project_state import ProjectState, state_path
from .recovery_manager import RecoveryAction, RecoveryDecision, RecoveryManager
from .report_manager import ReportManager


DEFAULT_INTERVAL_SECONDS = int(os.getenv("AUTODEV_INTERVAL_SECONDS", "900"))


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def hold_file_path() -> Path:
    return _project_root() / "reports" / "human-hold.md"


# ----- the one-cycle entry point -----------------------------------------


def run_once(*, dry_run: bool = False, report_only_override: bool = False) -> int:
    """Run exactly one supervisor cycle. Returns a process exit code."""
    state = ProjectState.load()
    cost_policy = CostPolicy.from_state(state)
    reporter = ReportManager(state)

    # Phase 1 of cycle: ingest commands from inbox.
    cmd_results = CommandManager(state).process_inbox()
    if not report_only_override:
        # /report command forces a report-only cycle.
        report_only_override = any(r.outcome == "queued" and r.name == "/report"
                                   for r in cmd_results)

    # Phase 2: decide next action.
    recovery = RecoveryManager(
        state, report_only=report_only_override, hold_file=hold_file_path(),
    )
    decision = recovery.decide_next_action()
    state["next_action"] = decision.action.value

    summary, success = _execute_decision(
        decision, state, cost_policy, dry_run=dry_run,
    )

    # Phase 3: write reports + state.
    reporter.cycle_finished(
        summary=summary,
        success=success,
        task_id=state["current_task_id"],
        notes=f"action={decision.action.value} reason={decision.reason}",
    )
    state["status"] = decision.action.value
    state["health_status"] = "green" if success else "warn"
    state.save()

    # Exit code: 0 = ok, 2 = held (no work but expected), 4 = exception.
    if not success and decision.action in (
        RecoveryAction.HOLD_FOR_HUMAN,
        RecoveryAction.PAUSE,
    ):
        return 2
    return 0 if success else 4


def _execute_decision(
    decision: RecoveryDecision,
    state: ProjectState,
    cost_policy: CostPolicy,
    *,
    dry_run: bool,
) -> tuple[str, bool]:
    """Apply the recovery decision; mutate state; return (summary, success)."""
    action = decision.action

    if action == RecoveryAction.PAUSE:
        return f"paused (reason={decision.reason})", True

    if action == RecoveryAction.HOLD_FOR_HUMAN:
        state["blocked"] = True
        state["human_needed"] = True
        state["blocker_reason"] = decision.detail or decision.reason
        return f"hold: {decision.detail or decision.reason}", False

    if action == RecoveryAction.REPORT_ONLY:
        return "report-only cycle", True

    if action == RecoveryAction.REPAIR_STATE:
        # Bootstrap — mark green and move on.
        state["health_status"] = "green"
        return "state initialised", True

    if action == RecoveryAction.SELECT_NEW:
        backlog = BacklogManager()
        task = backlog.next_unblocked()
        if not task:
            return "no work in backlog", True
        backlog.mark_in_progress(task.task_id)
        backlog.write_current(task)
        state["current_task_id"] = task.task_id
        state["current_task_title"] = task.title
        state["current_phase"] = "selected"
        state["repair_attempts_for_current_task"] = 0
        return _run_inner_engine(task, state, cost_policy, dry_run=dry_run)

    if action == RecoveryAction.CONTINUE_CURRENT:
        # Reload BacklogTask shape from current.md is optional — synthesise.
        synthetic = BacklogTask(
            task_id=state["current_task_id"],
            title=state["current_task_title"] or "",
            details="",
            priority="P?",
            status=".",
        )
        return _run_inner_engine(synthetic, state, cost_policy, dry_run=dry_run)

    return f"unknown action {action!r}", False


def _run_inner_engine(
    task: BacklogTask,
    state: ProjectState,
    cost_policy: CostPolicy,
    *,
    dry_run: bool,
) -> tuple[str, bool]:
    live = bool(state["live_allowed"]) and not dry_run
    engine = InnerEngine(cost_policy=cost_policy, dry_run=not live, live=live)
    result: EngineResult = engine.run_task(task, state)

    state["last_completed_step"] = "inner_engine_tick"
    if result.success:
        state["current_phase"] = "tick_ok"
        summary = f"inner engine ok ({result.duration_seconds:.1f}s)"
        if result.extra.get("dry_run"):
            summary = "[dry-run] " + summary
        return summary, True

    if result.blocked:
        state["blocked"] = True
        state["blocker_reason"] = result.blocker_reason
        state["repair_attempts_for_current_task"] = (
            (state["repair_attempts_for_current_task"] or 0) + 1
        )
        return f"inner engine blocked: {result.blocker_reason}", False

    return "inner engine failed (no detail)", False


# ----- the long-running supervisor ---------------------------------------


def run_supervisor(*, interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
                   dry_run: bool = False) -> int:
    stop = {"set": False}

    def _handle_signal(_sig, _frm):
        stop["set"] = True

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    while not stop["set"]:
        try:
            run_once(dry_run=dry_run)
        except Exception as e:  # noqa: BLE001
            # Catch-all: never crash the supervisor process.
            _write_panic(repr(e))
        if stop["set"]:
            break
        time.sleep(interval_seconds)
    return 0


def _write_panic(detail: str) -> None:
    p = _project_root() / "reports" / "session-log.md"
    try:
        with p.open("a") as f:
            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            f.write(f"\n- {ts}  supervisor.panic  detail={detail[:300]}")
    except OSError:
        pass


# ----- CLI ---------------------------------------------------------------


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="autodev.supervisor")
    p.add_argument("--once", action="store_true", help="run one cycle and exit")
    p.add_argument("--supervisor", action="store_true", help="run the long loop")
    p.add_argument("--dry-run", action="store_true", help="do not invoke inner engine for real")
    p.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS)
    p.add_argument("--report", action="store_true",
                   help="force report-only cycle (writes daily.md, exits)")
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    if args.supervisor:
        return run_supervisor(interval_seconds=args.interval, dry_run=args.dry_run)
    if args.once:
        return run_once(dry_run=args.dry_run, report_only_override=args.report)
    if args.report:
        return run_once(dry_run=True, report_only_override=True)
    # Default = --once with dry-run unless live explicitly enabled.
    return run_once(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
