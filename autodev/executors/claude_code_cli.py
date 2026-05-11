"""Claude Code CLI executor — subscription-first.

Two execution paths, probed at runtime:

  1. Host-direct: if `claude` is on $PATH, run it directly.
  2. Docker-fallback: if not, exec `claude` inside the existing
     `claude-code-247/runner:latest` image (built by `docker compose build`).

Either path produces a structured `ExecutionResult` with classification of
the failure (rate_limit / permission_needed / tests_failed / etc.). The CLI
output JSON envelope is parsed best-effort; raw stdout/stderr is preserved
in the result.

This executor MUST NOT require ANTHROPIC_API_KEY. It uses
CLAUDE_CODE_OAUTH_TOKEN if available (subscription), falls back to
ANTHROPIC_API_KEY if that's what's set in `.env`, and refuses to run if
neither auth source exists.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def session_log_path() -> Path:
    return _project_root() / "reports" / "session-log.md"


# --- failure classification -------------------------------------------------

_RATELIMIT_PATTERNS = ("rate limit", "rate_limit", "5-hour", "quota exceeded")
_PERMISSION_PATTERNS = ("permission denied", "permission_denied")
_TESTS_FAILED_PATTERNS = ("FAILED", "errors=", "FAIL: ")
_TIMEOUT_PATTERNS = ("timed out", "TimeoutError")
_BLOCKED_PATTERNS = ("Cannot proceed", "needs human", "human review required")


@dataclass
class ExecutionResult:
    success: bool = False
    blocked: bool = False
    needs_human: bool = False
    rate_limited: bool = False
    permission_needed: bool = False
    tests_failed: bool = False
    timed_out: bool = False
    cli_error: bool = False
    exit_code: Optional[int] = None
    stdout: str = ""
    stderr: str = ""
    summary: str = ""
    next_action: Optional[str] = None
    cost_usd_estimate: float = 0.0
    duration_seconds: float = 0.0
    raw_json: dict = field(default_factory=dict)

    def classify(self) -> str:
        if self.rate_limited:
            return "rate_limited"
        if self.permission_needed:
            return "permission_needed"
        if self.timed_out:
            return "timeout"
        if self.tests_failed:
            return "tests_failed"
        if self.blocked or self.needs_human:
            return "needs_human"
        if self.cli_error:
            return "cli_error"
        if self.success:
            return "success"
        return "unknown"


# --- executor ---------------------------------------------------------------


class ClaudeCodeCLIExecutor:
    """Subscription-first Claude Code CLI wrapper.

    Args:
      via_docker: force the Docker fallback (else auto-detect).
      docker_image: runner image tag (default: claude-code-247/runner:latest).
      timeout_seconds: hard cap per invocation.
    """

    DEFAULT_IMAGE = "claude-code-247/runner:latest"
    DEFAULT_TIMEOUT_SECONDS = 1800

    def __init__(
        self,
        *,
        via_docker: Optional[bool] = None,
        docker_image: str = DEFAULT_IMAGE,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ):
        self.image = docker_image
        self.timeout = timeout_seconds
        if via_docker is None:
            via_docker = os.getenv("AUTODEV_CLI_VIA_DOCKER", "auto").lower()
            if via_docker == "auto":
                # Auto: prefer host CLI if present, else Docker.
                via_docker = (shutil.which("claude") is None)
            elif via_docker in ("0", "false"):
                via_docker = False
            else:
                via_docker = True
        self.via_docker = bool(via_docker)

    # ----- public API ----------------------------------------------------

    def is_available(self) -> tuple[bool, str]:
        """Cheap probe — returns (ok, reason)."""
        if self.via_docker:
            if shutil.which("docker") is None:
                return False, "docker CLI not on PATH"
            return self._docker_image_exists()
        if shutil.which("claude") is None:
            return False, "claude CLI not on PATH (set AUTODEV_CLI_VIA_DOCKER=1)"
        return True, "host claude CLI present"

    def run_prompt(
        self,
        prompt: str,
        *,
        system_prompt: Optional[str] = None,
        model: str = "claude-sonnet-4-6",
        allowed_tools: str = "Read,Grep,Glob",
        permission_mode: str = "bypassPermissions",
        extra_args: Optional[list[str]] = None,
    ) -> ExecutionResult:
        """Run one CLI invocation and return a structured result."""
        ok, reason = self.is_available()
        if not ok:
            r = ExecutionResult(cli_error=True, summary=f"CLI unavailable: {reason}")
            self._log("cli_unavailable", r)
            return r

        argv = self._build_argv(
            prompt=prompt,
            system_prompt=system_prompt,
            model=model,
            allowed_tools=allowed_tools,
            permission_mode=permission_mode,
            extra_args=extra_args or [],
        )

        started = time.time()
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                env=self._env(),
            )
        except subprocess.TimeoutExpired as e:
            r = ExecutionResult(
                timed_out=True,
                cli_error=True,
                exit_code=None,
                stdout=e.stdout or "",
                stderr=(e.stderr or "") + f"\ntimed out after {self.timeout}s",
                summary="CLI timed out",
                duration_seconds=time.time() - started,
            )
            self._log("timeout", r)
            return r
        except (OSError, subprocess.SubprocessError) as e:
            r = ExecutionResult(
                cli_error=True,
                summary=f"subprocess error: {e}",
                duration_seconds=time.time() - started,
            )
            self._log("subprocess_error", r)
            return r

        elapsed = time.time() - started
        return self._parse_result(proc, elapsed)

    # ----- argv construction --------------------------------------------

    def _build_argv(
        self,
        *,
        prompt: str,
        system_prompt: Optional[str],
        model: str,
        allowed_tools: str,
        permission_mode: str,
        extra_args: list[str],
    ) -> list[str]:
        cli_args = [
            "claude",
            "--print",
            "--model", model,
            "--allowedTools", allowed_tools,
            "--output-format", "json",
            "--permission-mode", permission_mode,
        ]
        if system_prompt:
            cli_args.extend(["--append-system-prompt", system_prompt])
        cli_args.extend(extra_args)
        cli_args.append(prompt)

        if not self.via_docker:
            return cli_args

        # Docker fallback: --rm, non-root user, HOME=/tmp, mount nothing.
        token_var, token = self._token_env()
        docker_argv = [
            "docker", "run", "--rm",
            "-e", f"HOME=/tmp",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "--entrypoint", "sh",
        ]
        if token:
            docker_argv.extend(["-e", f"{token_var}={token}"])
        docker_argv.append(self.image)
        # Use sh -c to allow proper quoting; pass the CLI argv as a single shell
        # string. shlex.quote each fragment to keep model arg / prompt safe.
        cmd_str = " ".join(shlex.quote(a) for a in cli_args)
        docker_argv.extend(["-c", cmd_str])
        return docker_argv

    def _token_env(self) -> tuple[str, str]:
        oat = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or ""
        anth = os.environ.get("ANTHROPIC_API_KEY") or ""
        if oat:
            return ("CLAUDE_CODE_OAUTH_TOKEN", oat)
        if anth.startswith("sk-ant-oat01-"):
            return ("CLAUDE_CODE_OAUTH_TOKEN", anth)
        if anth:
            return ("ANTHROPIC_API_KEY", anth)
        return ("ANTHROPIC_API_KEY", "")

    def _env(self) -> dict[str, str]:
        env = dict(os.environ)
        # Route token by prefix even in host mode.
        anth = env.get("ANTHROPIC_API_KEY", "")
        if anth.startswith("sk-ant-oat01-") and "CLAUDE_CODE_OAUTH_TOKEN" not in env:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = anth
            del env["ANTHROPIC_API_KEY"]
        return env

    def _docker_image_exists(self) -> tuple[bool, str]:
        try:
            out = subprocess.run(
                ["docker", "image", "inspect", self.image],
                capture_output=True, text=True, timeout=10,
            )
        except (OSError, subprocess.SubprocessError) as e:
            return False, f"docker inspect failed: {e}"
        if out.returncode != 0:
            return False, f"image {self.image} not built (run docker compose build)"
        return True, f"docker image {self.image} present"

    # ----- result parsing -----------------------------------------------

    def _parse_result(self, proc: subprocess.CompletedProcess, elapsed: float) -> ExecutionResult:
        r = ExecutionResult(
            exit_code=proc.returncode,
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
            duration_seconds=elapsed,
        )

        # Try parsing CLI JSON envelope.
        parsed: dict = {}
        text_to_classify = r.stdout + "\n" + r.stderr
        try:
            parsed = json.loads(r.stdout.strip().splitlines()[-1])
        except (IndexError, ValueError, json.JSONDecodeError):
            pass
        r.raw_json = parsed if isinstance(parsed, dict) else {}

        if r.raw_json:
            r.cost_usd_estimate = float(r.raw_json.get("total_cost_usd", 0.0) or 0.0)
            inner = r.raw_json.get("result") or ""
            text_to_classify = inner + "\n" + text_to_classify
            r.summary = (inner.splitlines() or [""])[0][:200] if inner else ""
            r.success = not bool(r.raw_json.get("is_error"))

        # Classify by content.
        low = text_to_classify.lower()
        if any(p.lower() in low for p in _RATELIMIT_PATTERNS):
            r.rate_limited = True
            r.success = False
        if any(p.lower() in low for p in _PERMISSION_PATTERNS):
            r.permission_needed = True
            r.success = False
        if any(p in text_to_classify for p in _TESTS_FAILED_PATTERNS):
            r.tests_failed = True
        if any(p in text_to_classify for p in _TIMEOUT_PATTERNS):
            r.timed_out = True
        if any(p.lower() in low for p in _BLOCKED_PATTERNS):
            r.blocked = True
            r.needs_human = True
            r.success = False

        # Exit code overrides success for clear failures.
        if proc.returncode != 0 and not (r.rate_limited or r.tests_failed):
            r.cli_error = True
            if not r.summary:
                # Pull first line of stderr.
                first = (r.stderr.splitlines() or [""])[0]
                r.summary = first[:200] or "non-zero exit, no stderr"

        if r.success and not r.summary:
            r.summary = "ok"

        self._log("execution", r)
        return r

    # ----- log helper ---------------------------------------------------

    def _log(self, event: str, r: ExecutionResult) -> None:
        try:
            log = session_log_path()
            log.parent.mkdir(parents=True, exist_ok=True)
            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            line = (
                f"\n- {ts}  cli.{event}  classify={r.classify()}  "
                f"exit={r.exit_code}  duration={r.duration_seconds:.1f}s  "
                f"cost~${r.cost_usd_estimate:.4f}  summary={r.summary[:120]}"
            )
            with log.open("a") as f:
                f.write(line)
        except OSError:
            pass
