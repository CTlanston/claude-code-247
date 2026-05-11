"""InnerEngine — adapter onto the existing Auto-Evo orchestrator.

Per spec §8 and §2.1 we do NOT rewrite the inner engine. We provide a thin
adapter that lets the AutoDev v3 supervisor call a single inner tick.

Two backends:

  * `subprocess` (default) — shells out to `python3 -m orchestrator.main_oneshot`
    so a crash inside the inner engine never crashes the supervisor process.
    This requires a `--one-shot` entry point on orchestrator.main; we add a
    minimal helper (`orchestrator/main_oneshot.py`) that imports `main` and
    calls one loop iteration explicitly.
  * `in-process` (for dry-run / tests only) — imports orchestrator.main and
    runs one tick directly. Skipped when `cost_policy` denies it.

EngineResult mirrors the spec §8 schema. If a backend isn't available it
returns `blocked=True, blocker_reason="..."`, and the supervisor records a
HOLD item.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .cost_policy import CostPolicy
from .project_state import ProjectState


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


@dataclass
class EngineResult:
    success: bool = False
    blocked: bool = False
    blocker_reason: Optional[str] = None
    needs_human: bool = False
    branch: Optional[str] = None
    worktree: Optional[str] = None
    commit: Optional[str] = None
    pr_url: Optional[str] = None
    test_result: Optional[str] = None
    ci_result: Optional[str] = None
    guardian_result: Optional[str] = None
    next_action: Optional[str] = None
    stdout: str = ""
    stderr: str = ""
    duration_seconds: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)


class InnerEngine:
    """Wraps the existing Auto-Evo state machine."""

    def __init__(
        self,
        *,
        cost_policy: Optional[CostPolicy] = None,
        backend: str = "subprocess",
        dry_run: bool = False,
        live: bool = False,
    ):
        self.cost_policy = cost_policy
        self.backend = backend
        self.dry_run = dry_run
        self.live = live

    # ----- public entry ---------------------------------------------------

    def run_task(self, task: Any, state: ProjectState) -> EngineResult:
        """Run one inner-engine tick against the given task.

        In dry-run mode, we don't actually spawn containers or call the API —
        we just return a stub result that mimics what would happen.
        """
        started = time.time()
        if self.dry_run or not self.live:
            return self._dry_run_result(task, started)

        # If cost policy denies even the basic CLI executor, we're in lockdown.
        if self.cost_policy is not None:
            decision = self.cost_policy.is_executor_allowed("claude_code_cli")
            if not decision.allowed:
                return EngineResult(
                    blocked=True,
                    blocker_reason=f"cost policy denies CLI: {decision.reason}",
                    duration_seconds=time.time() - started,
                )

        if self.backend == "subprocess":
            return self._run_subprocess(task, state, started)
        if self.backend == "in_process":
            return self._run_in_process(task, state, started)
        return EngineResult(
            blocked=True,
            blocker_reason=f"unknown backend {self.backend!r}",
            duration_seconds=time.time() - started,
        )

    # ----- backends -------------------------------------------------------

    def _dry_run_result(self, task: Any, started: float) -> EngineResult:
        tid = getattr(task, "task_id", "?") if task else "?"
        title = getattr(task, "title", "?") if task else "?"
        return EngineResult(
            success=True,
            next_action="report_only",
            stdout=f"[dry-run] would run inner engine for {tid} ({title})",
            duration_seconds=time.time() - started,
            extra={"dry_run": True},
        )

    def _run_subprocess(self, task: Any, state: ProjectState, started: float) -> EngineResult:
        """Shell out to a one-shot inner-engine invocation.

        We rely on `orchestrator/main_oneshot.py` (added alongside this
        wrapper) which imports the existing `main` module and runs exactly
        one tick. If that helper isn't present, we bail with a hold reason.
        """
        helper = _project_root() / "orchestrator" / "main_oneshot.py"
        if not helper.exists():
            return EngineResult(
                blocked=True,
                blocker_reason=(
                    "orchestrator/main_oneshot.py missing. The supervisor needs "
                    "a one-shot entry point on the inner engine; add the helper "
                    "or set live_allowed=false until the wiring lands."
                ),
                duration_seconds=time.time() - started,
            )
        argv = [sys.executable, str(helper)]
        tid = getattr(task, "task_id", None)
        if tid:
            argv += ["--task-id", tid]
        try:
            proc = subprocess.run(
                argv,
                cwd=str(_project_root()),
                capture_output=True,
                text=True,
                timeout=1800,
                env=self._child_env(),
            )
        except subprocess.TimeoutExpired as e:
            return EngineResult(
                blocked=True,
                blocker_reason="inner engine timed out (1800s)",
                stdout=e.stdout or "",
                stderr=(e.stderr or "") + "\n[timeout]",
                duration_seconds=time.time() - started,
            )
        except (OSError, subprocess.SubprocessError) as e:
            return EngineResult(
                blocked=True,
                blocker_reason=f"subprocess error: {e}",
                duration_seconds=time.time() - started,
            )
        success = proc.returncode == 0
        return EngineResult(
            success=success,
            blocked=not success,
            blocker_reason=None if success else f"inner engine exit {proc.returncode}",
            stdout=proc.stdout,
            stderr=proc.stderr,
            duration_seconds=time.time() - started,
        )

    def _run_in_process(self, task: Any, state: ProjectState, started: float) -> EngineResult:
        """In-process backend. Less safe (a crash in main.py kills the
        supervisor process), so guard behind explicit opt-in. Currently
        UNUSED — kept as a stub for future tests."""
        return EngineResult(
            blocked=True,
            blocker_reason="in_process backend not yet implemented",
            duration_seconds=time.time() - started,
        )

    # ----- env ------------------------------------------------------------

    def _child_env(self) -> dict[str, str]:
        env = dict(os.environ)
        # Make sure the inner engine sees the supervisor's intent.
        env.setdefault("AUTODEV_CONTEXT", "1")
        return env
