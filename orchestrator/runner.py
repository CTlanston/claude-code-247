"""Spawn a headless runner per role-call.

Two paths share this surface:
  - Docker (production): builds the runner image, mounts a per-issue worktree,
    runs the entrypoint script with the role's env, returns parsed result.json.
  - Local (LOCAL_MODE=1): bypasses Docker and dispatches to local_runner.py.
    This exists so the orchestrator can be exercised on a dev box without
    Docker / Claude Code CLI installed.

Worktree management lives in git_proxy.py. This module owns role config and
container lifecycle only.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

import db
import local_runner

WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", "/tmp/claude-247-workspaces"))
# When the orchestrator runs inside a container talking to the host docker
# daemon (compose case), bind-mount sources must be host-visible paths, not
# in-container paths. Compose passes WORKSPACE_ROOT_HOST=$PWD/workspaces.
# Outside Docker, fall back to WORKSPACE_ROOT.
WORKSPACE_ROOT_HOST = Path(os.getenv("WORKSPACE_ROOT_HOST", str(WORKSPACE_ROOT)))
PROMPT_DIR = Path(__file__).parent / "roles"
RUNNER_IMAGE = os.getenv("RUNNER_IMAGE", "claude-code-247/runner:latest")

#  Tool whitelist is the real security boundary — the volume is always RW
#  because every role's entrypoint must write /workspace/result.json after the
#  model exits. Planner/Reviewer/Guardian can't actually modify code because
#  they don't have Edit/Write/Bash in their tool list.
ROLE_CONFIG = {
    "planner": {
        "model_env": "PLANNER_MODEL",
        "tools": "Read,Grep,Glob,WebSearch",
        "token_limit": 50_000,
    },
    "coder": {
        "model_env": "CODER_MODEL",
        "tools": "Read,Edit,Write,Bash,Grep,Glob",
        "token_limit": 200_000,
    },
    "reviewer": {
        "model_env": "REVIEWER_MODEL",
        "tools": "Read,Grep,Glob,Bash",
        "token_limit": 80_000,
    },
    "guardian": {
        "model_env": "GUARDIAN_MODEL",
        "tools": "Read",
        "token_limit": 30_000,
    },
}


def _local_mode() -> bool:
    return os.getenv("LOCAL_MODE", "0") == "1"


def _cost_estimate(model: str, in_tok: int, out_tok: int) -> float:
    if "opus" in model:
        return in_tok * 15 / 1e6 + out_tok * 75 / 1e6
    if "sonnet" in model:
        return in_tok * 3 / 1e6 + out_tok * 15 / 1e6
    if "haiku" in model:
        return in_tok * 0.8 / 1e6 + out_tok * 4 / 1e6
    return 0.0


def run_role(role: str, issue_id: int, user_prompt: str,
             extra_volumes: Optional[dict] = None,
             plan: Optional[dict] = None) -> dict:
    """Run a role once, return {exit_code, result, cost_usd, run_dir}."""
    cfg = ROLE_CONFIG[role]
    model = os.getenv(cfg["model_env"])
    if not model:
        raise RuntimeError(f"model env {cfg['model_env']} not set")

    workspace = WORKSPACE_ROOT / f"issue-{issue_id}"

    if _local_mode():
        out = local_runner.run_role_local(
            role, issue_id, user_prompt,
            extra_volumes=extra_volumes,
            workspace=workspace,
            plan=plan,
        )
        db.record_run(
            issue_id=issue_id,
            role=role,
            started_at=time.time() - 1,
            finished_at=time.time(),
            exit_code=out["exit_code"],
            in_tokens=out.get("in_tokens", 0),
            out_tokens=out.get("out_tokens", 0),
            cost=out["cost_usd"],
            summary=str((out["result"] or {}).get("summary", ""))[:500],
        )
        return out

    return _run_docker(role, issue_id, user_prompt, cfg, model, workspace, extra_volumes)


def _run_docker(role: str, issue_id: int, user_prompt: str, cfg: dict, model: str,
                workspace: Path, extra_volumes: Optional[dict]) -> dict:
    import docker  # imported lazily so LOCAL_MODE doesn't need the SDK installed

    client = docker.from_env()
    workspace.mkdir(parents=True, exist_ok=True)
    run_dir = workspace / f"{role}-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    run_dir.mkdir()
    (run_dir / "prompt.txt").write_text(user_prompt, encoding="utf-8")
    # The CLI looks for /workspace/prompt.txt — keep a copy at the workspace root too.
    (workspace / "prompt.txt").write_text(user_prompt, encoding="utf-8")

    # Compute the host-visible mount source. If WORKSPACE_ROOT_HOST is set
    # (compose case), use that. Otherwise the orchestrator is on the host and
    # in-container == host paths.
    host_workspace = WORKSPACE_ROOT_HOST / f"issue-{issue_id}"

    # Role prompts are baked into the runner image at /system_prompts/<role>.md
    # so we don't need to bind-mount them. Volume is always RW because each
    # role's entrypoint writes result.json on exit; the tool whitelist is what
    # constrains what the model itself can do.
    volumes = {
        str(host_workspace): {"bind": "/workspace", "mode": "rw"},
    }
    if extra_volumes:
        volumes.update(extra_volumes)

    # Auth: route the token to the right env var based on its prefix.
    # - sk-ant-oat01-...  → CLAUDE_CODE_OAUTH_TOKEN (subscription billing)
    # - sk-ant-api03-...  → ANTHROPIC_API_KEY       (API console billing)
    # Both come in via the .env's ANTHROPIC_API_KEY slot for user convenience;
    # we route here.  Empirical fact (verified 2026-05-08): putting an oat01
    # token in ANTHROPIC_API_KEY hits api.anthropic.com with x-api-key header
    # and gets a hard 401 "Invalid API key · Fix external API key".
    raw_token = os.environ["ANTHROPIC_API_KEY"]
    auth_env: dict[str, str] = {}
    if raw_token.startswith("sk-ant-oat01-"):
        auth_env["CLAUDE_CODE_OAUTH_TOKEN"] = raw_token
    else:
        auth_env["ANTHROPIC_API_KEY"] = raw_token

    env = {
        **auth_env,
        "CLAUDE_MODEL": model,
        "CLAUDE_ROLE": role,
        "CLAUDE_ALLOWED_TOOLS": cfg["tools"],
        "CLAUDE_TOKEN_LIMIT": str(cfg["token_limit"]),
        "CLAUDE_PERMISSION_MODE": "bypassPermissions",
        # Without HOME the CLI tries to write ~/.claude as the host uid (no
        # passwd entry inside the container) and bombs.
        "HOME": "/tmp",
    }

    # Resolve the uid/gid that the runner container should run as. When the
    # orchestrator runs on the host, os.getuid() is the host user. When it
    # runs inside its own container (compose case), HOST_UID/HOST_GID are
    # passed in via compose so we run the runner as the host user rather than
    # the orchestrator container's user.
    runner_uid = int(os.getenv("HOST_UID", str(os.getuid())))
    runner_gid = int(os.getenv("HOST_GID", str(os.getgid())))

    started = time.time()
    container = client.containers.run(
        RUNNER_IMAGE,
        command=["/entrypoint.sh"],
        environment=env,
        volumes=volumes,
        working_dir="/workspace",
        # CLI refuses uid=0; any non-zero uid is fine. Match the host user so
        # the bind-mounted workspace is writable without an explicit chown.
        user=f"{runner_uid}:{runner_gid}",
        network_mode="bridge",  # production: replace with proxy that allowlists egress
        mem_limit="4g",
        nano_cpus=2_000_000_000,
        detach=True,
        remove=False,
        name=f"claude-{role}-{issue_id}-{uuid.uuid4().hex[:6]}",
    )
    try:
        result = container.wait(timeout=1800)
        exit_code = result["StatusCode"]
        logs = container.logs().decode("utf-8", errors="replace")
    except Exception:
        container.kill()
        raise
    finally:
        container.remove(force=True)

    finished = time.time()
    result_file = workspace / "result.json"
    parsed: dict = {}
    if result_file.exists():
        try:
            parsed = json.loads(result_file.read_text())
        except Exception:
            parsed = {"raw": result_file.read_text()[:2000]}

    in_tok = int(parsed.get("usage", {}).get("input_tokens", 0))
    out_tok = int(parsed.get("usage", {}).get("output_tokens", 0))
    cost = parsed.get("cost_usd", _cost_estimate(model, in_tok, out_tok))

    db.record_run(
        issue_id=issue_id,
        role=role,
        started_at=started,
        finished_at=finished,
        exit_code=exit_code,
        in_tokens=in_tok,
        out_tokens=out_tok,
        cost=cost,
        summary=str(parsed.get("summary", ""))[:500],
    )
    (run_dir / "stdout.log").write_text(logs, encoding="utf-8")
    return {
        "exit_code": exit_code,
        "result": parsed,
        "cost_usd": cost,
        "run_dir": str(run_dir),
        "in_tokens": in_tok,
        "out_tokens": out_tok,
    }
