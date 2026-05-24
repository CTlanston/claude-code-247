"""FastAPI dashboard.

Pages grow per milestone. M7 fills out: /prs, /prs/{repo}/{pr},
/repos/{repo_id}, /budgets, /logs, /alerts, /memory, /settings, plus
POST endpoints for approve/reject that enqueue commands.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from gateway.status_board import (
    collect_status_board,
    render_plain,
    runtime_is_ok,
)
from memory.db import default_db_path, init_db, open_db
from orchestrator import alert_deduper, budget_manager, log_indexer, metrics, webhooks
from orchestrator.command_queue import enqueue, list_commands
from orchestrator.config import load_config
from orchestrator.onboarding import onboard, validate_spec
from orchestrator.repo_registry import load_registry, sync_to_db
from orchestrator.task_manager import get_task, get_timeline, list_tasks

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200


def _clamp_pagination(limit: int, offset: int) -> tuple[int, int]:
    limit = max(1, min(MAX_PAGE_LIMIT, int(limit or DEFAULT_PAGE_LIMIT)))
    offset = max(0, int(offset or 0))
    return limit, offset


def create_app() -> FastAPI:
    app = FastAPI(title="claude-code-247", version="1.0.0-alpha.0")
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

    # ── system ──────────────────────────────────────────────────────

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        return JSONResponse({"ok": True})

    @app.get("/metrics")
    async def metrics_endpoint() -> Any:
        from fastapi.responses import PlainTextResponse
        init_db()
        return PlainTextResponse(metrics.render(),
                                  media_type="text/plain; version=0.0.4")

    # ── status board (M22b watchdog) ───────────────────────────────

    @app.get("/status-board", response_class=HTMLResponse)
    async def status_board_page(request: Request) -> HTMLResponse:
        init_db()
        board = collect_status_board()
        ctx = {
            "request": request,
            "title": "Watchdog — claude-code-247",
            "board": board,
            "runtime_ok": runtime_is_ok(board.runtime_health),
            "plain_dump": render_plain(board),
        }
        return templates.TemplateResponse(request, "status_board.html", ctx)

    @app.get("/status-board.json")
    async def status_board_json() -> JSONResponse:
        init_db()
        return JSONResponse(collect_status_board().to_dict())

    # ── overview ────────────────────────────────────────────────────

    @app.get("/", response_class=HTMLResponse)
    async def home(request: Request) -> HTMLResponse:
        cfg = load_config()
        init_db()
        entries = load_registry()
        with open_db() as conn:
            task_count = int(
                conn.execute("SELECT COUNT(*) AS c FROM tasks").fetchone()["c"]
            )
            cmd_count = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM commands WHERE status IN ('queued','running','requires_approval')"
                ).fetchone()["c"]
            )
            pr_open = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM prs WHERE state IN ('draft','open')"
                ).fetchone()["c"]
            )
            alerts_open = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM alerts WHERE acknowledged = 0"
                ).fetchone()["c"]
            )
        ctx = {
            "request": request,
            "title": "claude-code-247",
            "auth_mode": cfg.auth_mode,
            "allow_remote_writes": cfg.allow_remote_writes,
            "repo_count": len(entries),
            "enabled_repos": sum(1 for e in entries if e.enabled),
            "task_count": task_count,
            "pending_commands": cmd_count,
            "open_prs": pr_open,
            "open_alerts": alerts_open,
            "db_path": str(default_db_path()),
        }
        return templates.TemplateResponse(request, "home.html", ctx)

    # ── repos ───────────────────────────────────────────────────────

    @app.get("/repos", response_class=HTMLResponse)
    async def repos_page(request: Request) -> HTMLResponse:
        init_db()
        entries = load_registry()
        ctx = {
            "request": request,
            "title": "Repos — claude-code-247",
            "entries": entries,
        }
        return templates.TemplateResponse(request, "repos.html", ctx)

    @app.get("/repos/{repo_id}", response_class=HTMLResponse)
    async def repo_detail(request: Request, repo_id: str) -> HTMLResponse:
        init_db()
        entries = load_registry()
        match = [e for e in entries if e.id == repo_id]
        if not match:
            raise HTTPException(status_code=404, detail="repo not found")
        entry = match[0]
        with open_db() as conn:
            tasks = list(conn.execute(
                "SELECT id, status, goal, created_at FROM tasks WHERE repo_id = ? "
                "ORDER BY created_at DESC LIMIT 50", (repo_id,)
            ).fetchall())
            prs = list(conn.execute(
                "SELECT pr_number, branch, state, approval_state, risk_score, url, "
                "created_at FROM prs WHERE repo_id = ? ORDER BY created_at DESC LIMIT 50",
                (repo_id,),
            ).fetchall())
        budget = budget_manager.get_snapshot(repo_id).to_dict()
        ctx = {
            "request": request, "title": f"{entry.name} — claude-code-247",
            "entry": entry, "tasks": tasks, "prs": prs, "budget": budget,
        }
        return templates.TemplateResponse(request, "repo_detail.html", ctx)

    # ── tasks ───────────────────────────────────────────────────────

    @app.get("/tasks", response_class=HTMLResponse)
    async def tasks_page(request: Request, limit: int = DEFAULT_PAGE_LIMIT,
                          offset: int = 0) -> HTMLResponse:
        init_db()
        limit, offset = _clamp_pagination(limit, offset)
        with open_db() as conn:
            total = int(conn.execute("SELECT COUNT(*) AS c FROM tasks").fetchone()["c"])
            rows = list(conn.execute(
                "SELECT id, repo_id, goal, status, created_at FROM tasks "
                "ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall())
        ctx = {
            "request": request,
            "title": "Tasks — claude-code-247",
            "tasks": [{"id": r["id"], "repo_id": r["repo_id"], "goal": r["goal"],
                       "status": r["status"], "created_at": r["created_at"]}
                      for r in rows],
            "pagination": {
                "limit": limit, "offset": offset, "total": total,
                "base": "/tasks",
            },
        }
        return templates.TemplateResponse(request, "tasks.html", ctx)

    @app.get("/tasks/{task_id}", response_class=HTMLResponse)
    async def task_detail(request: Request, task_id: str) -> HTMLResponse:
        init_db()
        t = get_task(task_id)
        if t is None:
            raise HTTPException(status_code=404, detail="task not found")
        events = get_timeline(task_id)
        ctx = {
            "request": request,
            "title": f"Task {task_id[:14]} — claude-code-247",
            "task": t, "events": events,
        }
        return templates.TemplateResponse(request, "task_detail.html", ctx)

    # ── prs ────────────────────────────────────────────────────────

    @app.get("/prs", response_class=HTMLResponse)
    async def prs_page(request: Request, limit: int = DEFAULT_PAGE_LIMIT,
                        offset: int = 0) -> HTMLResponse:
        init_db()
        limit, offset = _clamp_pagination(limit, offset)
        with open_db() as conn:
            total = int(conn.execute("SELECT COUNT(*) AS c FROM prs").fetchone()["c"])
            rows = list(conn.execute(
                "SELECT repo_id, pr_number, branch, title, state, approval_state, "
                "risk_score, url, created_at FROM prs "
                "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall())
        ctx = {"request": request, "title": "PRs — claude-code-247", "prs": rows,
                "pagination": {"limit": limit, "offset": offset, "total": total,
                                "base": "/prs"}}
        return templates.TemplateResponse(request, "prs.html", ctx)

    @app.get("/prs/{repo_id}/{pr_number}", response_class=HTMLResponse)
    async def pr_detail(request: Request, repo_id: str, pr_number: int) -> HTMLResponse:
        init_db()
        with open_db() as conn:
            pr = conn.execute(
                "SELECT * FROM prs WHERE repo_id = ? AND pr_number = ?",
                (repo_id, pr_number),
            ).fetchone()
            if pr is None:
                raise HTTPException(status_code=404, detail="PR not found")
            validators = list(conn.execute(
                "SELECT validator, verdict, confidence, summary FROM validator_results "
                "WHERE task_id = ? ORDER BY created_at DESC", (pr["task_id"],),
            ).fetchall()) if pr["task_id"] else []
            risk = conn.execute(
                "SELECT score, level, factors_json, created_at FROM risk_scores "
                "WHERE pr_id = ? ORDER BY created_at DESC LIMIT 1", (pr["id"],),
            ).fetchone()
            ci = list(conn.execute(
                "SELECT workflow_name, status, url, created_at FROM ci_results "
                "WHERE pr_id = ? ORDER BY created_at DESC LIMIT 20", (pr["id"],),
            ).fetchall())
        ctx = {
            "request": request,
            "title": f"{repo_id}#{pr_number} — claude-code-247",
            "pr": pr, "validators": validators, "ci": ci,
            "risk": dict(risk) if risk else None,
            "risk_factors": json.loads(risk["factors_json"]) if risk else [],
        }
        return templates.TemplateResponse(request, "pr_detail.html", ctx)

    @app.post("/prs/{repo_id}/{pr_number}/approve")
    async def pr_approve(repo_id: str, pr_number: int) -> RedirectResponse:
        init_db()
        enqueue("approve_merge", source="dashboard", repo_id=repo_id, pr_number=pr_number)
        return RedirectResponse(f"/prs/{repo_id}/{pr_number}", status_code=303)

    @app.post("/prs/{repo_id}/{pr_number}/reject")
    async def pr_reject(repo_id: str, pr_number: int,
                        reason: str = Form("")) -> RedirectResponse:
        init_db()
        enqueue("reject_merge", source="dashboard", repo_id=repo_id, pr_number=pr_number,
                payload={"reason": reason})
        return RedirectResponse(f"/prs/{repo_id}/{pr_number}", status_code=303)

    # ── commands ───────────────────────────────────────────────────

    @app.get("/commands", response_class=HTMLResponse)
    async def commands_page(request: Request, limit: int = DEFAULT_PAGE_LIMIT,
                             offset: int = 0) -> HTMLResponse:
        init_db()
        limit, offset = _clamp_pagination(limit, offset)
        with open_db() as conn:
            total = int(conn.execute("SELECT COUNT(*) AS c FROM commands").fetchone()["c"])
        rows = list_commands(limit=limit + offset)[offset:offset + limit]
        ctx = {"request": request, "title": "Commands — claude-code-247",
               "commands": rows,
               "pagination": {"limit": limit, "offset": offset, "total": total,
                               "base": "/commands"}}
        return templates.TemplateResponse(request, "commands.html", ctx)

    # ── budgets ────────────────────────────────────────────────────

    @app.get("/budgets", response_class=HTMLResponse)
    async def budgets_page(request: Request) -> HTMLResponse:
        init_db()
        entries = load_registry()
        snaps = [budget_manager.get_snapshot(e.id).to_dict() for e in entries]
        ctx = {"request": request, "title": "Budgets — claude-code-247",
               "snaps": snaps}
        return templates.TemplateResponse(request, "budgets.html", ctx)

    # ── logs ───────────────────────────────────────────────────────

    @app.get("/logs", response_class=HTMLResponse)
    async def logs_page(request: Request, q: str = "", level: str = "",
                        component: str = "", repo: str = "", task: str = "",
                        limit: int = DEFAULT_PAGE_LIMIT,
                        offset: int = 0) -> HTMLResponse:
        init_db()
        limit, offset = _clamp_pagination(limit, offset)
        entries = log_indexer.search(
            text=q or None, level=level or None,
            component=component or None, repo_id=repo or None,
            task_id=task or None, limit=limit + offset,
        )[offset:offset + limit]
        base = f"/logs?q={q}&level={level}&component={component}&repo={repo}&task={task}"
        ctx = {
            "request": request, "title": "Logs — claude-code-247",
            "logs": entries, "filter_q": q, "filter_level": level,
            "filter_component": component, "filter_repo": repo, "filter_task": task,
            "pagination": {"limit": limit, "offset": offset, "total": None,
                            "base": base},
        }
        return templates.TemplateResponse(request, "logs.html", ctx)

    # ── alerts ─────────────────────────────────────────────────────

    @app.get("/alerts", response_class=HTMLResponse)
    async def alerts_page(request: Request) -> HTMLResponse:
        init_db()
        rows = alert_deduper.list_open()
        ctx = {"request": request, "title": "Alerts — claude-code-247",
               "alerts": rows}
        return templates.TemplateResponse(request, "alerts.html", ctx)

    @app.post("/alerts/{alert_id}/ack")
    async def alert_ack(alert_id: str) -> RedirectResponse:
        init_db()
        alert_deduper.acknowledge(alert_id)
        return RedirectResponse("/alerts", status_code=303)

    # ── memory (stub) ──────────────────────────────────────────────

    @app.get("/memory", response_class=HTMLResponse)
    async def memory_page(request: Request) -> HTMLResponse:
        init_db()
        with open_db() as conn:
            rows = list(conn.execute(
                "SELECT repo_id, item_type, COUNT(*) AS c FROM memory_items "
                "GROUP BY repo_id, item_type ORDER BY repo_id, item_type"
            ).fetchall())
        ctx = {"request": request, "title": "Memory — claude-code-247",
               "rows": rows}
        return templates.TemplateResponse(request, "memory.html", ctx)

    # ── settings ───────────────────────────────────────────────────

    @app.get("/settings", response_class=HTMLResponse)
    async def settings_page(request: Request) -> HTMLResponse:
        cfg = load_config()
        ctx = {
            "request": request, "title": "Settings — claude-code-247",
            "config_json": json.dumps(cfg.raw, indent=2, sort_keys=True),
            "policies_json": json.dumps(cfg.policies, indent=2, sort_keys=True),
            "db_path": str(default_db_path()),
        }
        return templates.TemplateResponse(request, "settings.html", ctx)

    # ── onboarding ─────────────────────────────────────────────────

    @app.get("/onboarding", response_class=HTMLResponse)
    async def onboarding_form(request: Request) -> HTMLResponse:
        ctx = {"request": request, "title": "Add repo — claude-code-247",
               "errors": [], "warnings": [], "form": {}}
        return templates.TemplateResponse(request, "onboarding.html", ctx)

    @app.post("/onboarding")
    async def onboarding_submit(
        request: Request,
        repo_id: str = Form(""),
        github_owner: str = Form(""),
        github_repo: str = Form(""),
        local_path: str = Form(""),
        default_branch: str = Form("main"),
        forbidden_paths: str = Form(".env, .env.*, .github/**, secrets/**, CLAUDE.md, AGENTS.md"),
        test_command: str = Form(""),
        lint_command: str = Form(""),
        auto_merge: str = Form("off"),
        probe_local: str = Form("on"),
    ) -> Any:
        spec: dict[str, Any] = {
            "id": repo_id, "github_owner": github_owner, "github_repo": github_repo,
            "local_path": local_path, "default_branch": default_branch,
            "enabled": True, "risk_level": "low",
            "forbidden_paths": [p.strip() for p in forbidden_paths.split(",") if p.strip()],
            "auto_merge": {"enabled": auto_merge == "on"},
        }
        if test_command:
            spec["test_commands"] = [test_command]
        if lint_command:
            spec["lint_commands"] = [lint_command]
        existing = {e.id for e in load_registry()}
        pre = validate_spec(spec, existing_ids=existing)
        if not pre.ok:
            ctx = {"request": request, "title": "Add repo",
                   "errors": pre.errors, "warnings": pre.warnings, "form": spec}
            return templates.TemplateResponse(request, "onboarding.html", ctx)
        res = onboard(spec, probe_local=(probe_local == "on"))
        if not res.ok:
            ctx = {"request": request, "title": "Add repo",
                   "errors": res.errors, "warnings": res.warnings, "form": spec}
            return templates.TemplateResponse(request, "onboarding.html", ctx)
        return RedirectResponse("/repos", status_code=303)

    @app.post("/tasks/start")
    async def start_task(
        request: Request,
        repo_id: str = Form(...),
        goal: str = Form(...),
    ) -> Any:
        init_db()
        sync_to_db(load_registry())
        cmd = enqueue(
            "start_task",
            source="dashboard",
            repo_id=repo_id,
            payload={"repo_id": repo_id, "goal": goal},
        )
        return JSONResponse({"command_id": cmd.id, "status": cmd.status})

    @app.post("/webhooks/github")
    async def github_webhook(request: Request) -> JSONResponse:
        body = await request.body()
        signature = request.headers.get("x-hub-signature-256")
        event = request.headers.get("x-github-event") or ""
        cfg = load_config()
        secret = (cfg.get("github.webhook_secret") or "").strip()
        if not secret:
            raise HTTPException(status_code=503,
                                 detail="github.webhook_secret not configured")
        if not webhooks.verify_signature(body=body, signature_header=signature,
                                          secret=secret):
            raise HTTPException(status_code=401, detail="bad signature")
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="invalid json")
        init_db()
        outcome = webhooks.dispatch(event=event, payload=payload)
        return JSONResponse({
            "event": outcome.event, "action": outcome.action,
            "handled": outcome.handled, "summary": outcome.summary,
        })

    return app


app = create_app()
