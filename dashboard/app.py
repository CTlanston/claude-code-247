"""FastAPI dashboard.

Pages grow per milestone. M2 adds: /tasks/{id} (timeline), /commands,
/onboarding (wizard form), POST /onboarding (submit).

Every write action POSTs to a route that enqueues a command — the dashboard
never executes destructive ops directly.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from memory.db import default_db_path, init_db, open_db
from orchestrator.command_queue import enqueue, list_commands
from orchestrator.config import load_config
from orchestrator.onboarding import onboard, validate_spec
from orchestrator.repo_registry import load_registry, sync_to_db
from orchestrator.task_manager import get_task, get_timeline, list_tasks

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"


def create_app() -> FastAPI:
    app = FastAPI(title="claude-code-247", version="1.0.0-alpha.0")
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        return JSONResponse({"ok": True})

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
        ctx = {
            "request": request,
            "title": "claude-code-247",
            "auth_mode": cfg.auth_mode,
            "allow_remote_writes": cfg.allow_remote_writes,
            "repo_count": len(entries),
            "enabled_repos": sum(1 for e in entries if e.enabled),
            "task_count": task_count,
            "pending_commands": cmd_count,
            "db_path": str(default_db_path()),
        }
        return templates.TemplateResponse(request, "home.html", ctx)

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

    @app.get("/tasks", response_class=HTMLResponse)
    async def tasks_page(request: Request) -> HTMLResponse:
        init_db()
        rows = list_tasks(limit=100)
        ctx = {
            "request": request,
            "title": "Tasks — claude-code-247",
            "tasks": [{"id": t.id, "repo_id": t.repo_id, "goal": t.goal,
                       "status": t.status, "created_at": t.created_at}
                      for t in rows],
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
            "task": t,
            "events": events,
        }
        return templates.TemplateResponse(request, "task_detail.html", ctx)

    @app.get("/commands", response_class=HTMLResponse)
    async def commands_page(request: Request) -> HTMLResponse:
        init_db()
        rows = list_commands(limit=200)
        ctx = {
            "request": request,
            "title": "Commands — claude-code-247",
            "commands": rows,
        }
        return templates.TemplateResponse(request, "commands.html", ctx)

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

    return app


app = create_app()
