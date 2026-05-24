"""Command dispatcher — drains the queue and executes one command per tick.

Each ``run_once`` call:

  1. Honors the global system-pause flag (system_state.is_system_paused).
  2. Claims the oldest queued command via command_queue.claim_next.
  3. Routes to the right ``handle_*`` function.
  4. Marks the command succeeded / failed / requires_approval.
  5. Records a structured log entry for the audit page.

Long-form ``start_task`` is the heavy lift: it walks
prepare_workspace → worker → validators → risk → merge_policy →
state machine → notification, synchronously. One tick = one task. If
the launchd plist fires --once every 30s, the dispatcher chews through
the queue at that cadence.

Real PR creation + git push is deferred (the operator selected
"launchd daemon, no PR creation" for this round). We compute the
merge ruling and route the task into the right lane; an external
agent / future M12 picks up the actual push.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from memory.db import open_db
from orchestrator import (
    budget_manager,
    ci_poller,
    coverage_parser,
    github_client as _github_client,
    log_indexer,
    notification_manager,
    system_state,
)
from orchestrator.command_queue import Command, CommandStatus, claim_next, complete, enqueue
from orchestrator.config import load_config
from orchestrator.ids import make_id, utc_now_iso
from orchestrator.merge_policy import MergeDecision, decide as merge_decide
from orchestrator.repo_registry import RepoEntry, load_registry
from orchestrator.risk_score import DiffStats, compute_risk
from orchestrator.runner_manager import RunnerManager, RunnerManagerError
from orchestrator.task_manager import (
    TaskStatus, create_task, get_task, get_timeline, list_tasks, transition,
)
from validator.judge_contract import JudgeInput
from validator.validation_policy import validate as validate_evidence


@dataclass
class DispatchResult:
    handled: bool                  # True if a command was claimed
    command_id: str | None = None
    command_type: str | None = None
    status: str | None = None      # final command status
    result: dict[str, Any] | None = None
    reason: str | None = None      # populated when handled=False

    def to_dict(self) -> dict[str, Any]:
        return {
            "handled": self.handled,
            "command_id": self.command_id,
            "command_type": self.command_type,
            "status": self.status,
            "result": self.result,
            "reason": self.reason,
        }


HANDLED_COMMAND_TYPES = (
    "start_task", "pause_repo", "resume_repo", "pause_task", "resume_task",
    "stop_task", "stop_all", "explain_stuck", "approve_merge", "reject_merge",
    "set_mode", "approve_command", "reject_command",
)


# ── public entry points ─────────────────────────────────────────────


def run_once(
    *,
    runner: RunnerManager | None = None,
    validator_fn: Callable[[JudgeInput], Any] | None = None,
    notify_fn: Callable[..., Any] | None = None,
    github=None,
    poll_ci: bool = True,
    db_path: Path | str | None = None,
) -> DispatchResult:
    """Process at most one queued command."""
    if system_state.is_system_paused(db_path=db_path):
        return DispatchResult(handled=False, reason="system paused")

    if poll_ci:
        try:
            ci_poller.poll_open_prs(github=github, db_path=db_path)
        except Exception as e:  # never let CI poll break the dispatcher
            log_indexer.write(level="warn", component="dispatcher",
                               message=f"ci_poller error: {e}",
                               db_path=db_path)

    cmd = claim_next(types=list(HANDLED_COMMAND_TYPES), db_path=db_path)
    if cmd is None:
        return DispatchResult(handled=False, reason="queue empty")

    handler = HANDLERS.get(cmd.command_type)
    if handler is None:
        complete(cmd.id, CommandStatus.failed,
                  error=f"no handler for {cmd.command_type!r}",
                  db_path=db_path)
        return DispatchResult(handled=True, command_id=cmd.id,
                              command_type=cmd.command_type,
                              status="failed", reason="no handler")

    try:
        result = handler(
            cmd,
            runner=runner,
            validator_fn=validator_fn,
            notify_fn=notify_fn,
            github=github,
            db_path=db_path,
        )
    except Exception as e:  # pragma: no cover — surfaced via command row
        complete(cmd.id, CommandStatus.failed, error=str(e), db_path=db_path)
        log_indexer.write(level="error", component="dispatcher",
                           message=f"{cmd.command_type} handler raised",
                           payload={"error": str(e), "command_id": cmd.id},
                           db_path=db_path)
        return DispatchResult(handled=True, command_id=cmd.id,
                              command_type=cmd.command_type,
                              status="failed", result={"error": str(e)})

    status = (result or {}).get("_status", "succeeded")
    if status == "requires_approval":
        complete(cmd.id, CommandStatus.requires_approval, result=result, db_path=db_path)
    elif status == "rejected":
        complete(cmd.id, CommandStatus.rejected, result=result, db_path=db_path)
    else:
        complete(cmd.id, CommandStatus.succeeded, result=result, db_path=db_path)
    return DispatchResult(handled=True, command_id=cmd.id,
                          command_type=cmd.command_type,
                          status=status, result=result)


def run_loop(
    *,
    interval_seconds: float | None = None,
    max_iterations: int | None = None,
    runner: RunnerManager | None = None,
    db_path: Path | str | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> list[DispatchResult]:
    """Long-running dispatcher loop. Used by `claude247 dispatcher --loop`.
    Polls the queue every ``interval_seconds`` (default from config). Stops
    after ``max_iterations`` if set — useful for tests."""
    cfg = load_config()
    interval = interval_seconds if interval_seconds is not None else float(
        cfg.get("system.poll_interval_seconds", 30) or 30
    )
    seen: list[DispatchResult] = []
    i = 0
    while True:
        if max_iterations is not None and i >= max_iterations:
            return seen
        i += 1
        res = run_once(runner=runner, db_path=db_path)
        seen.append(res)
        if not res.handled:
            sleep_fn(interval)
        # If a command WAS handled, loop again immediately — the queue
        # might have more.


# ── handlers ────────────────────────────────────────────────────────


def handle_start_task(
    cmd: Command,
    *,
    runner: RunnerManager | None = None,
    validator_fn: Callable[[JudgeInput], Any] | None = None,
    notify_fn: Callable[..., Any] | None = None,
    github=None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    payload = cmd.payload or {}
    repo_id = payload.get("repo_id") or cmd.repo_id
    goal = payload.get("goal") or "(unspecified)"
    if not repo_id:
        return {"error": "start_task missing repo_id"}
    notify = notify_fn or notification_manager.notify

    if system_state.is_repo_paused(repo_id, db_path=db_path):
        return {"deferred": True, "reason": f"repo {repo_id} paused"}

    repo = _get_repo(repo_id)
    if repo is None:
        return {"error": f"unknown repo {repo_id!r}"}

    budget_ok, budget_reasons = budget_manager.check_caps(
        repo_id, repo_raw=repo.raw, db_path=db_path,
    )
    if not budget_ok:
        notify(event="budget_exceeded", message=", ".join(budget_reasons),
               repo_id=repo_id)
        return {"deferred": True, "reason": "budget exceeded",
                "details": budget_reasons}

    task = create_task(
        repo_id=repo_id, goal=goal,
        source=cmd.source, source_ref=cmd.id,
        db_path=db_path,
    )
    budget_manager.increment(repo_id, counter="tasks_count", db_path=db_path)
    notify(event="task_started", message=goal[:200],
           repo_id=repo_id, task_id=task.id)
    log_indexer.write(level="info", component="dispatcher",
                       message=f"start_task → {task.id}",
                       repo_id=repo_id, task_id=task.id, db_path=db_path)

    runner = runner or RunnerManager(backend="local")

    # Phase 1 — workspace + worker
    transition(task.id, TaskStatus.planning,
               message="prepare_workspace + worker", db_path=db_path)
    try:
        prep = runner.prepare_workspace(task_id=task.id, repo_id=repo_id, goal=goal)
        spec = runner.build_task_spec(task_id=task.id, repo=repo,
                                       goal=goal, branch=prep.branch)
        outcome = runner.run(
            prep=prep, spec=spec,
            allow_roles=payload.get("allow_roles", True),
        )
    except (RunnerManagerError, subprocess.CalledProcessError, OSError) as e:
        transition(task.id, TaskStatus.failed,
                   message=f"runner error: {e}", db_path=db_path)
        notify(event="task_failed", message=str(e)[:200],
               repo_id=repo_id, task_id=task.id)
        return {"task_id": task.id, "phase": "runner", "error": str(e)}
    budget_manager.increment(repo_id, counter="worker_runs_count", db_path=db_path)
    budget_manager.increment(repo_id, counter="local_cc_run_count", db_path=db_path)

    # Phase 2 — validators on the evidence package
    transition(task.id, TaskStatus.validating,
               branch=prep.branch, message="validators on .evidence/",
               db_path=db_path)
    evidence_dir = prep.workspace / ".evidence"
    inp = JudgeInput.from_evidence_dir(evidence_dir, task_id=task.id, repo_id=repo_id)
    if validator_fn is not None:
        # Test injection — caller provides the policy directly.
        validation = validator_fn(inp)
    else:
        validation = validate_evidence(inp)
    for vr in validation.results:
        _record_validator_result(task.id, vr, db_path=db_path)
        budget_manager.increment(repo_id, counter="validator_runs_count",
                                  db_path=db_path)

    # Phase 3 — diff + coverage + risk score
    diff, diff_content = _diff_against_base(prep.workspace, repo.default_branch)
    coverage_pct = coverage_parser.extract_coverage_pct(prep.workspace)
    risk = compute_risk(
        diff,
        allowed_paths=(repo.raw or {}).get("allowed_paths") or ["**"],
        forbidden_paths=(repo.raw or {}).get("forbidden_paths") or [],
        validators=validation.results,
        ci_passed=None,
        test_results=_evidence_json(evidence_dir, "test_results.json", []),
        lint_results=_evidence_json(evidence_dir, "lint_results.json", []),
        coverage_pct=coverage_pct,
        diff_content=diff_content,
    )
    _record_risk_score(task.id, risk, db_path=db_path)

    # Phase 4 — merge policy
    test_passed = all(
        r.get("exit", 0) == 0
        for r in _evidence_json(evidence_dir, "test_results.json", [])
    )
    lint_passed = all(
        r.get("exit", 0) == 0
        for r in _evidence_json(evidence_dir, "lint_results.json", [])
    )
    ruling = merge_decide(
        risk=risk,
        validators=validation,
        repo=repo,
        ci_passed=None,
        tests_passed=test_passed,
        lint_passed=lint_passed,
    )

    # Phase 5 — commit, push + PR create (when allowed), transition + notify
    cfg = load_config()
    gh = github or _github_client
    summary = {
        "task_id": task.id,
        "branch": prep.branch,
        "worker_exit": outcome.exit_code,
        "risk_score": risk.score,
        "risk_level": risk.level,
        "validators": [r.to_dict() for r in validation.results],
        "ruling": ruling.to_dict(),
        "pushed": False,
        "pr": None,
        "merged": False,
    }

    if ruling.decision is MergeDecision.BLOCKED:
        transition(task.id, TaskStatus.pr_created, branch=prep.branch,
                   risk_score=risk.score,
                   message=f"ruling: {ruling.decision.value}", db_path=db_path)
        transition(task.id, TaskStatus.failed,
                   message="; ".join(ruling.reasons)[:200], db_path=db_path)
        notify(event="task_failed",
               message=f"blocked: {ruling.reasons[-1] if ruling.reasons else 'no reason'}",
               repo_id=repo_id, task_id=task.id)
        summary["next"] = "blocked"
        log_indexer.write(level="info", component="dispatcher",
                           message=f"start_task complete → blocked",
                           payload=summary, repo_id=repo_id, task_id=task.id,
                           db_path=db_path)
        return summary

    # Commit any worker-produced changes (excluding .evidence/).
    commit_sha = None
    try:
        commit_sha = runner.commit_changes(prep,
                                            message=f"agent({task.id[:10]}): {goal[:80]}")
        summary["commit_sha"] = commit_sha
    except RunnerManagerError as e:
        log_indexer.write(level="warn", component="dispatcher",
                           message=f"commit_changes: {e}",
                           repo_id=repo_id, task_id=task.id, db_path=db_path)

    # Try to push + open a PR when the global gate is open. Failures
    # here are non-fatal — we still set the task into the ruling lane.
    pr_number: int | None = None
    pr_url: str | None = None
    pr_record_id: str | None = None
    if cfg.allow_remote_writes and commit_sha:
        try:
            runner.rewire_origin_to_github(prep)
            pushed = runner.push_branch(prep)
            summary["pushed"] = pushed
            if pushed:
                pr_title = f"agent: {goal[:60]}"
                pr_body = _pr_body(task.id, repo_id, risk, validation, ruling)
                created = gh.create_draft_pr(
                    repo=repo.github_full_name,
                    branch=prep.branch,
                    title=pr_title,
                    body=pr_body,
                    base=repo.default_branch,
                    workspace=str(prep.workspace),
                )
                pr_number = created.number
                pr_url = created.url
                pr_record_id = _record_pr(
                    repo_id=repo_id, task_id=task.id,
                    pr_number=created.number, branch=prep.branch,
                    title=pr_title, body=pr_body, url=created.url,
                    state="draft",
                    approval_state=("required"
                                     if ruling.decision is MergeDecision.WAITING_APPROVAL
                                     else "not_required"),
                    risk_score=risk.score, db_path=db_path,
                )
                summary["pr"] = {"number": pr_number, "url": pr_url,
                                  "record_id": pr_record_id}
                notify(event="pr_created",
                       message=f"{repo.github_full_name}#{pr_number} {pr_title}",
                       repo_id=repo_id, task_id=task.id, pr_number=pr_number)
        except (RunnerManagerError, _github_client.GitHubError, OSError) as e:
            log_indexer.write(level="error", component="dispatcher",
                               message=f"push/PR failed: {e}",
                               repo_id=repo_id, task_id=task.id, db_path=db_path)
            summary["push_pr_error"] = str(e)

    transition(task.id, TaskStatus.pr_created, branch=prep.branch,
               pr_number=pr_number, risk_score=risk.score,
               message=f"ruling: {ruling.decision.value}", db_path=db_path)

    if ruling.decision is MergeDecision.AUTO_MERGE:
        transition(task.id, TaskStatus.auto_merging,
                   message="auto-merge ruling", db_path=db_path)
        merged_ok = False
        if cfg.allow_remote_writes and pr_number is not None:
            try:
                merge_method = ((repo.raw or {}).get("auto_merge") or {}).get(
                    "method", "squash"
                )
                gh.merge_pr(repo=repo.github_full_name, number=pr_number,
                             method=merge_method, delete_branch=True)
                merged_ok = True
                summary["merged"] = True
                if pr_record_id:
                    _mark_pr_merged(pr_record_id, db_path=db_path)
            except _github_client.GitHubError as e:
                log_indexer.write(level="error", component="dispatcher",
                                   message=f"gh pr merge: {e}",
                                   repo_id=repo_id, task_id=task.id,
                                   db_path=db_path)
                summary["merge_error"] = str(e)
        if merged_ok:
            transition(task.id, TaskStatus.merged,
                       message="auto-merge completed", db_path=db_path)
            notify(event="auto_merge_completed",
                   message=f"{repo.github_full_name}#{pr_number} merged",
                   repo_id=repo_id, task_id=task.id, pr_number=pr_number)
            summary["next"] = "merged"
        else:
            # Either flag off, no PR, or merge failed — leave task in
            # auto_merging so an operator can intervene.
            transition(task.id, TaskStatus.failed,
                       message=("gh pr merge failed" if summary.get("merge_error")
                                else "auto_merge ruling but writes off / no PR"),
                       db_path=db_path)
            notify(event="task_failed",
                   message=f"{task.id} auto-merge not applied",
                   repo_id=repo_id, task_id=task.id, pr_number=pr_number)
            summary["next"] = "auto_merge_not_applied"
    elif ruling.decision is MergeDecision.WAITING_APPROVAL:
        transition(task.id, TaskStatus.waiting_for_approval,
                   message="; ".join(ruling.reasons)[:200], db_path=db_path)
        notify(event="approval_required",
               message=f"{repo_id} task {task.id} risk={risk.score}"
                       + (f" PR #{pr_number}" if pr_number else ""),
               repo_id=repo_id, task_id=task.id, pr_number=pr_number)
        summary["next"] = "waiting_for_approval"

    log_indexer.write(level="info", component="dispatcher",
                       message=f"start_task complete → {ruling.decision.value}",
                       payload=summary, repo_id=repo_id, task_id=task.id,
                       db_path=db_path)
    return summary


def handle_pause_repo(cmd: Command, *, notify_fn=None, db_path=None, **_) -> dict:
    if not cmd.repo_id:
        return {"error": "missing repo_id"}
    system_state.pause_repo(cmd.repo_id, db_path=db_path)
    log_indexer.write(level="info", component="dispatcher",
                       message=f"paused repo {cmd.repo_id}",
                       repo_id=cmd.repo_id, db_path=db_path)
    return {"paused": cmd.repo_id}


def handle_resume_repo(cmd: Command, *, db_path=None, **_) -> dict:
    if not cmd.repo_id:
        return {"error": "missing repo_id"}
    system_state.resume_repo(cmd.repo_id, db_path=db_path)
    log_indexer.write(level="info", component="dispatcher",
                       message=f"resumed repo {cmd.repo_id}",
                       repo_id=cmd.repo_id, db_path=db_path)
    return {"resumed": cmd.repo_id}


def handle_pause_task(cmd: Command, *, db_path=None, **_) -> dict:
    if not cmd.task_id:
        return {"error": "missing task_id"}
    t = get_task(cmd.task_id, db_path=db_path)
    if t is None:
        return {"error": f"unknown task {cmd.task_id}"}
    if t.status in {"merged", "failed", "cancelled", "paused"}:
        return {"noop": True, "current_status": t.status}
    transition(cmd.task_id, TaskStatus.paused,
               message="paused by operator", db_path=db_path)
    return {"paused": cmd.task_id}


def handle_resume_task(cmd: Command, *, db_path=None, **_) -> dict:
    if not cmd.task_id:
        return {"error": "missing task_id"}
    t = get_task(cmd.task_id, db_path=db_path)
    if t is None:
        return {"error": f"unknown task {cmd.task_id}"}
    if t.status != "paused":
        return {"noop": True, "current_status": t.status}
    target = (cmd.payload or {}).get("to_status") or "queued"
    transition(cmd.task_id, TaskStatus(target),
               message=f"resumed -> {target}", db_path=db_path)
    return {"resumed": cmd.task_id, "to_status": target}


def handle_stop_task(cmd: Command, *, db_path=None, **_) -> dict:
    if not cmd.task_id:
        return {"error": "missing task_id"}
    t = get_task(cmd.task_id, db_path=db_path)
    if t is None:
        return {"error": f"unknown task {cmd.task_id}"}
    if t.status in {"merged", "failed", "cancelled"}:
        return {"noop": True, "current_status": t.status}
    transition(cmd.task_id, TaskStatus.cancelled,
               message="cancelled by operator", db_path=db_path)
    return {"cancelled": cmd.task_id}


def handle_stop_all(cmd: Command, *, notify_fn=None, db_path=None, **_) -> dict:
    notify = notify_fn or notification_manager.notify
    system_state.pause_system(db_path=db_path)
    active = list_tasks(db_path=db_path)
    cancelled: list[str] = []
    for t in active:
        if t.status in {"queued", "planning", "coding", "testing", "reviewing",
                         "validating", "pr_created", "waiting_for_approval"}:
            try:
                transition(t.id, TaskStatus.paused,
                           message="stop_all: paused", db_path=db_path)
                cancelled.append(t.id)
            except ValueError:
                pass
    notify(event="system_paused",
           message=f"stop-all: paused {len(cancelled)} task(s)")
    log_indexer.write(level="warn", component="dispatcher",
                       message=f"stop_all: {len(cancelled)} tasks paused",
                       db_path=db_path)
    return {"system_paused": True, "paused_tasks": cancelled}


def handle_explain_stuck(cmd: Command, *, db_path=None, **_) -> dict:
    if not cmd.task_id:
        return {"error": "missing task_id"}
    t = get_task(cmd.task_id, db_path=db_path)
    if t is None:
        return {"error": f"unknown task {cmd.task_id}"}
    events = get_timeline(cmd.task_id, db_path=db_path)
    last = events[-1] if events else None
    summary = {
        "task_id": t.id, "repo_id": t.repo_id, "goal": t.goal,
        "status": t.status, "branch": t.branch,
        "last_event": {
            "at": last["created_at"], "type": last["event_type"],
            "message": last["message"],
        } if last else None,
        "recommended_next": _recommended_next(t.status),
        "safe_commands": [
            f"claude247 replay --task {t.id} --explain-only",
            f"claude247 logs tail --task {t.id} --limit 50",
            f"claude247 task {t.id}",
        ],
    }
    return summary


def handle_approve_merge(cmd: Command, *, db_path=None, notify_fn=None,
                          github=None, **_) -> dict:
    if not cmd.repo_id or cmd.pr_number is None:
        return {"error": "missing repo_id or pr_number"}
    notify = notify_fn or notification_manager.notify
    gh = github or _github_client
    cfg = load_config()

    with open_db(db_path) as conn:
        pr = conn.execute(
            "SELECT id, task_id FROM prs WHERE repo_id = ? AND pr_number = ?",
            (cmd.repo_id, cmd.pr_number),
        ).fetchone()
        if pr is None:
            return {"error": f"PR not found: {cmd.repo_id}#{cmd.pr_number}"}
        pr_id = pr["id"]
        task_id = pr["task_id"]
        conn.execute(
            "UPDATE prs SET approval_state = 'approved', updated_at = ? "
            "WHERE id = ?",
            (utc_now_iso(), pr_id),
        )
        conn.execute(
            "INSERT INTO decisions (id, repo_id, task_id, topic, decided_by, "
            "decision, rationale, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (make_id("dec"), cmd.repo_id, task_id,
             f"PR #{cmd.pr_number} approval", cmd.created_by, "approved",
             (cmd.payload or {}).get("reason") or "", utc_now_iso()),
        )

    out: dict[str, Any] = {"approved": True, "pr": cmd.pr_number,
                            "merged": False}
    # Try the actual merge when the gate is open.
    repo = _get_repo(cmd.repo_id)
    if cfg.allow_remote_writes and repo is not None:
        try:
            method = ((repo.raw or {}).get("auto_merge") or {}).get("method", "squash")
            gh.merge_pr(repo=repo.github_full_name, number=cmd.pr_number,
                         method=method, delete_branch=True)
            out["merged"] = True
            _mark_pr_merged(pr_id, db_path=db_path)
            if task_id:
                try:
                    transition(task_id, TaskStatus.auto_merging,
                               message="approve_merge fired", db_path=db_path)
                except ValueError:
                    pass
                try:
                    transition(task_id, TaskStatus.merged,
                               message="merged via approve_merge",
                               db_path=db_path)
                except ValueError:
                    pass
            notify(event="auto_merge_completed",
                   message=f"approved+merged {cmd.repo_id}#{cmd.pr_number}",
                   repo_id=cmd.repo_id, task_id=task_id,
                   pr_number=cmd.pr_number)
        except _github_client.GitHubError as e:
            out["merge_error"] = str(e)
            log_indexer.write(level="error", component="dispatcher",
                               message=f"approve_merge: gh pr merge: {e}",
                               repo_id=cmd.repo_id, task_id=task_id,
                               db_path=db_path)
            notify(event="task_failed",
                   message=f"approve fired but merge failed: {e}",
                   repo_id=cmd.repo_id, task_id=task_id,
                   pr_number=cmd.pr_number)
    else:
        # Approval recorded, but the gate is closed; operator must flip
        # allow_remote_writes for the actual merge.
        notify(event="approval_required",
               message=f"approved {cmd.repo_id}#{cmd.pr_number} "
                       f"(allow_remote_writes off; not merged)",
               repo_id=cmd.repo_id, task_id=task_id, pr_number=cmd.pr_number)
    return out


def handle_reject_merge(cmd: Command, *, db_path=None, **_) -> dict:
    if not cmd.repo_id or cmd.pr_number is None:
        return {"error": "missing repo_id or pr_number"}
    with open_db(db_path) as conn:
        pr = conn.execute(
            "SELECT id, task_id FROM prs WHERE repo_id = ? AND pr_number = ?",
            (cmd.repo_id, cmd.pr_number),
        ).fetchone()
        if pr is None:
            return {"error": f"PR not found: {cmd.repo_id}#{cmd.pr_number}"}
        conn.execute(
            "UPDATE prs SET approval_state = 'rejected', updated_at = ? "
            "WHERE id = ?",
            (utc_now_iso(), pr["id"]),
        )
        conn.execute(
            "INSERT INTO decisions (id, repo_id, task_id, topic, decided_by, "
            "decision, rationale, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (make_id("dec"), cmd.repo_id, pr["task_id"],
             f"PR #{cmd.pr_number} approval", cmd.created_by, "rejected",
             (cmd.payload or {}).get("reason") or "", utc_now_iso()),
        )
    return {"rejected": True, "pr": cmd.pr_number}


def handle_set_mode(cmd: Command, *, db_path=None, **_) -> dict:
    mode = (cmd.payload or {}).get("mode")
    if mode == "paused":
        system_state.pause_system(db_path=db_path)
        return {"system_paused": True}
    if mode == "running":
        system_state.resume_system(db_path=db_path)
        return {"system_paused": False}
    return {"error": f"unknown mode {mode!r}"}


def handle_approve_command(cmd: Command, *, db_path=None, **_) -> dict:
    target_id = (cmd.payload or {}).get("command_id")
    if not target_id:
        return {"error": "payload.command_id required"}
    with open_db(db_path) as conn:
        conn.execute(
            "UPDATE commands SET status = 'queued' WHERE id = ? AND status = 'requires_approval'",
            (target_id,),
        )
    return {"approved": target_id}


def handle_reject_command(cmd: Command, *, db_path=None, **_) -> dict:
    target_id = (cmd.payload or {}).get("command_id")
    if not target_id:
        return {"error": "payload.command_id required"}
    with open_db(db_path) as conn:
        conn.execute(
            "UPDATE commands SET status = 'rejected', error = ? "
            "WHERE id = ? AND status IN ('queued','requires_approval')",
            ((cmd.payload or {}).get("reason") or "operator-rejected", target_id),
        )
    return {"rejected": target_id}


HANDLERS: dict[str, Callable[..., dict[str, Any]]] = {
    "start_task": handle_start_task,
    "pause_repo": handle_pause_repo,
    "resume_repo": handle_resume_repo,
    "pause_task": handle_pause_task,
    "resume_task": handle_resume_task,
    "stop_task": handle_stop_task,
    "stop_all": handle_stop_all,
    "explain_stuck": handle_explain_stuck,
    "approve_merge": handle_approve_merge,
    "reject_merge": handle_reject_merge,
    "set_mode": handle_set_mode,
    "approve_command": handle_approve_command,
    "reject_command": handle_reject_command,
}


# ── helpers ─────────────────────────────────────────────────────────


def _get_repo(repo_id: str) -> RepoEntry | None:
    for r in load_registry():
        if r.id == repo_id:
            return r
    return None


def _diff_against_base(workspace: Path, base_branch: str) -> tuple[DiffStats, str]:
    """Returns (DiffStats, diff_text). The text body is what the
    secret_scanner and the database_migration heuristic look at."""
    try:
        out_numstat = subprocess.check_output(
            ["git", "-C", str(workspace), "diff", "--numstat", f"{base_branch}..HEAD"],
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return DiffStats(files=[], insertions=0, deletions=0), ""
    try:
        out_diff = subprocess.check_output(
            ["git", "-C", str(workspace), "diff", "-U0", f"{base_branch}..HEAD"],
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        out_diff = ""
    return DiffStats.from_git_numstat(out_numstat), out_diff


def _evidence_json(evidence_dir: Path, name: str, default):
    p = evidence_dir / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def _record_validator_result(task_id: str, vr, *,
                              db_path: Path | str | None) -> None:
    with open_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO validator_results (id, task_id, validator, verdict,
                                            confidence, summary,
                                            blocking_issues_json,
                                            non_blocking_issues_json,
                                            evidence_gaps_json,
                                            recommended_next_action,
                                            created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                make_id("vr"), task_id, vr.validator, vr.verdict,
                vr.confidence, vr.summary,
                json.dumps(vr.blocking_issues), json.dumps(vr.non_blocking_issues),
                json.dumps(vr.evidence_gaps), vr.recommended_next_action,
                utc_now_iso(),
            ),
        )


def _record_pr(
    *, repo_id: str, task_id: str, pr_number: int, branch: str, title: str,
    body: str, url: str, state: str, approval_state: str, risk_score: int,
    db_path: Path | str | None,
) -> str:
    pid = make_id("pr")
    now = utc_now_iso()
    with open_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO prs (id, repo_id, task_id, pr_number, branch, title,
                              body, url, state, approval_state, risk_score,
                              created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(repo_id, pr_number) DO UPDATE SET
              task_id = excluded.task_id, branch = excluded.branch,
              title = excluded.title, body = excluded.body, url = excluded.url,
              state = excluded.state, approval_state = excluded.approval_state,
              risk_score = excluded.risk_score, updated_at = excluded.updated_at
            """,
            (pid, repo_id, task_id, pr_number, branch, title, body, url,
             state, approval_state, risk_score, now, now),
        )
        row = conn.execute(
            "SELECT id FROM prs WHERE repo_id = ? AND pr_number = ?",
            (repo_id, pr_number),
        ).fetchone()
    return row["id"] if row else pid


def _mark_pr_merged(pr_id: str, *, db_path: Path | str | None) -> None:
    now = utc_now_iso()
    with open_db(db_path) as conn:
        conn.execute(
            "UPDATE prs SET state = 'merged', merged_at = ?, updated_at = ? "
            "WHERE id = ?",
            (now, now, pr_id),
        )


def _pr_body(task_id: str, repo_id: str, risk, validation, ruling) -> str:
    """Spec §11.4 PR body template."""
    val_lines = "\n".join(
        f"- **{r.validator}**: {r.verdict} (conf {r.confidence:.2f}) — {r.summary[:120]}"
        for r in validation.results
    ) or "_(none)_"
    factor_lines = "\n".join(
        f"- `{f.name}` (weight {f.weight}) — {f.reason}"
        for f in risk.triggered
    ) or "_(none)_"
    return f"""## Agent Task

- Task ID: `{task_id}`
- Repo: `{repo_id}`
- Risk: **{risk.score}** ({risk.level})
- Decision: **{ruling.decision.value}**

## Validator results

{val_lines}

## Risk factors

{factor_lines}

## Merge ruling reasons

{chr(10).join(f"- {r}" for r in ruling.reasons) or "- (none)"}

---
_Generated by claude-code-247 dispatcher. See `claude247 replay --task {task_id}` for full evidence._
"""


def _record_risk_score(task_id: str, risk, *,
                        db_path: Path | str | None) -> None:
    factors = [{"name": f.name, "weight": f.weight, "reason": f.reason}
               for f in risk.triggered]
    with open_db(db_path) as conn:
        conn.execute(
            "INSERT INTO risk_scores (id, task_id, score, level, factors_json, "
            "created_at) VALUES (?,?,?,?,?,?)",
            (make_id("rs"), task_id, risk.score, risk.level,
             json.dumps(factors), utc_now_iso()),
        )


_NEXT_BY_STATUS = {
    "queued": "wait — dispatcher will pick it up",
    "planning": "wait — planner running",
    "coding": "wait — coder running",
    "testing": "wait — tests running",
    "reviewing": "wait — reviewer running",
    "validating": "wait — validators running",
    "pr_created": "inspect the PR; auto-merge or approval pending",
    "waiting_for_approval": "claude247 approve-merge OR reject-merge",
    "auto_merging": "merge in flight — wait",
    "merged": "done",
    "stuck": "claude247 replay --task <id> --repair",
    "failed": "claude247 replay --task <id> --explain-only, then --repair",
    "paused": "claude247 resume --task <id>",
    "cancelled": "no action — task is cancelled",
}


def _recommended_next(status: str) -> str:
    return _NEXT_BY_STATUS.get(status, "inspect logs and task timeline")
