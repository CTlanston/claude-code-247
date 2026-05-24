"""FastAPI dashboard shell.

M1 provides:
  - GET /            health overview
  - GET /repos       registry view
  - GET /tasks       (stub — fills out in M2/M7)
  - GET /healthz     liveness probe

Routes added in later milestones extend this module.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from memory.db import default_db_path, init_db, open_db
from orchestrator.config import load_config
from orchestrator.repo_registry import load_registry

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
        with open_db() as conn:
            tasks = list(conn.execute(
                "SELECT id, repo_id, goal, status, created_at FROM tasks "
                "ORDER BY created_at DESC LIMIT 100"
            ).fetchall())
        ctx = {"request": request, "title": "Tasks — claude-code-247", "tasks": tasks}
        return templates.TemplateResponse(request, "tasks.html", ctx)

    return app


app = create_app()
