"""Local-mode runner: executes a role on the host (no Docker), returns the same
shape as runner.run_role().

Two backends:
  1. Anthropic SDK direct call when ANTHROPIC_API_KEY looks real (sk-ant-...).
     The SDK call uses the role's system prompt + user prompt, no tool use —
     the model returns text and the local runner is responsible for any FS ops
     implied by the role contract.
  2. Stub fixtures when ANTHROPIC_API_KEY is the placeholder. Deterministic,
     covers the four roles, lets the full state machine be exercised offline.

This file exists only to unblock single-machine development where Docker / the
claude CLI aren't installed. Production path stays in runner.py.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Optional

PROMPT_DIR = Path(__file__).parent / "roles"
WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", "/tmp/claude-247-workspaces"))


def _has_real_api_key() -> bool:
    key = os.getenv("ANTHROPIC_API_KEY", "")
    return key.startswith("sk-ant-") and "PLACEHOLDER" not in key and len(key) > 20


def _use_sdk() -> bool:
    """Should LOCAL_MODE call the Anthropic SDK or stay with stub fixtures?

    Default: stubs. Opt in by setting LOCAL_USE_SDK=1. We default to stubs even
    when a real key is present so the smoke tests stay deterministic and don't
    accidentally burn credit when the user is iterating on the orchestrator."""
    return _has_real_api_key() and os.getenv("LOCAL_USE_SDK", "0") == "1"


def _cost_estimate(model: str, in_tok: int, out_tok: int) -> float:
    if "opus" in model:
        return in_tok * 15 / 1e6 + out_tok * 75 / 1e6
    if "sonnet" in model:
        return in_tok * 3 / 1e6 + out_tok * 15 / 1e6
    if "haiku" in model:
        return in_tok * 0.8 / 1e6 + out_tok * 4 / 1e6
    return 0.0


def _maybe_inject_fault() -> Optional[dict]:
    """Honour fault-injection env vars used by smoke-test scripts.
    Returns a dict to short-circuit the role's normal output, or None."""
    if os.getenv("STUB_FAULT_RATELIMIT", "0") == "1":
        return {
            "is_error": True,
            "api_error_status": 429,
            "raw_text": "rate_limit_error: 5-hour window quota exceeded; retry later",
            "summary": "rate_limit_error: 5-hour window quota exceeded",
        }
    if os.getenv("STUB_FAULT_TERMINAL", "0") == "1":
        return {
            "is_error": True,
            "api_error_status": 400,
            "raw_text": "Credit balance is too low",
            "summary": "Credit balance is too low",
        }
    return None


def _stub_planner(workspace: Path, user_prompt: str) -> dict:
    """Deterministic plan: parse 'add foo() to bar' style titles into one TDD step."""
    fault = _maybe_inject_fault()
    if fault:
        return fault
    title_match = re.search(r"标题:\s*(.+)", user_prompt) or re.search(r"title:\s*(.+)", user_prompt, re.I)
    title = title_match.group(1).strip() if title_match else "auto-task"

    body_match = re.search(r"正文:\s*\n(.*)", user_prompt, re.S) or re.search(r"body:\s*\n(.*)", user_prompt, re.S | re.I)
    body = (body_match.group(1).strip() if body_match else "").splitlines()

    func_match = re.search(r"`?([a-z_][a-z0-9_]*)\s*\(", title + " " + " ".join(body), re.I)
    fn = func_match.group(1) if func_match else "do_thing"

    file_match = re.search(r"`?([a-z_][a-z0-9_/]*\.py)`?", title + " " + " ".join(body), re.I)
    target = file_match.group(1) if file_match else "src/utils.py"

    plan = {
        "title": title,
        "summary": f"Implement {fn}() in {target} with TDD",
        "steps": [
            {
                "id": 1,
                "goal": f"Add {fn}() to {target}",
                "files": [target, target.replace("src/", "tests/test_").replace(".py", ".py").replace("tests/test_tests", "tests")],
                "test_idea": f"unit test asserts {fn}() returns expected output for happy and edge cases",
                "risk": "low",
            }
        ],
        "out_of_scope": [],
    }
    return plan


def _stub_coder(workspace: Path, user_prompt: str, plan: dict) -> dict:
    """Deterministic coder: writes a `reverse(s)` style implementation + test, makes
    one `test:` and one `feat:` commit on the current branch.

    Fault-injection knobs (env vars, only honoured in LOCAL_MODE stub):
      STUB_CODER_SKIP_TEST=1  — skip the `test:` commit (drives Reviewer reject)
      STUB_CODER_SKIP_FEAT=1  — skip the `feat:` commit
      STUB_CODER_TOUCH_FORBIDDEN=1 — also modify `.github/workflows/dummy.yml`
                                    so the Reviewer's scope-check trips

    This is *intentionally* dumb — it proves the pipeline plumbing works without
    invoking a real model. Real Coder behaviour comes from the SDK path or the
    Docker entrypoint."""
    repo_dir = workspace / "repo"
    if not repo_dir.exists():
        return {"summary": "repo dir missing", "branch": None, "commits": [],
                "tests_added": [], "files_changed": []}

    step = plan["steps"][0] if plan.get("steps") else None
    if not step:
        return {"summary": "no steps", "branch": None, "commits": [],
                "tests_added": [], "files_changed": []}

    fn_match = re.search(r"Add\s+(\w+)\s*\(", step["goal"])
    fn = fn_match.group(1) if fn_match else "do_thing"

    src_path = repo_dir / "src" / "utils.py"
    test_path = repo_dir / "tests" / f"test_{fn}.py"
    src_path.parent.mkdir(parents=True, exist_ok=True)
    test_path.parent.mkdir(parents=True, exist_ok=True)

    skip_test = os.getenv("STUB_CODER_SKIP_TEST", "0") == "1"
    skip_feat = os.getenv("STUB_CODER_SKIP_FEAT", "0") == "1"
    touch_forbidden = os.getenv("STUB_CODER_TOUCH_FORBIDDEN", "0") == "1"

    commits: list[dict] = []

    def _commit_if_dirty(message: str) -> Optional[str]:
        # `git diff --cached --quiet` returns 1 if there ARE staged changes.
        chk = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo_dir)
        if chk.returncode == 0:
            return None  # nothing staged
        _git(repo_dir, "commit", "-m", message)
        return _git(repo_dir, "rev-parse", "HEAD").strip()

    # 1. Write failing test, commit `test:`
    if not skip_test:
        test_body = (
            f"from src.utils import {fn}\n\n"
            f"def test_{fn}_basic():\n"
            f"    assert {fn}('abc') == 'cba'\n\n"
            f"def test_{fn}_empty():\n"
            f"    assert {fn}('') == ''\n"
        )
        test_path.write_text(test_body)
        if not (repo_dir / "src" / "__init__.py").exists():
            (repo_dir / "src" / "__init__.py").write_text("")
        if not (repo_dir / "tests" / "__init__.py").exists():
            (repo_dir / "tests" / "__init__.py").write_text("")
        _git(repo_dir, "add", "tests/", "src/__init__.py", "tests/__init__.py")
        sha = _commit_if_dirty(f"test: {step['goal']}")
        if sha:
            commits.append({"sha": sha, "message": f"test: {step['goal']}"})

    # 2. Write implementation, commit `feat:`
    if not skip_feat:
        impl = f"def {fn}(s):\n    return s[::-1]\n"
        if src_path.exists():
            existing = src_path.read_text()
            if f"def {fn}(" not in existing:
                src_path.write_text(existing.rstrip() + "\n\n\n" + impl)
        else:
            src_path.write_text(impl)
        if touch_forbidden:
            wf_dir = repo_dir / ".github" / "workflows"
            wf_dir.mkdir(parents=True, exist_ok=True)
            (wf_dir / "dummy.yml").write_text(
                "name: dummy\non: push\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps: [{run: 'true'}]\n"
            )
            _git(repo_dir, "add", ".github/")
        _git(repo_dir, "add", "src/")
        sha = _commit_if_dirty(f"feat: {step['goal']}")
        if sha:
            commits.append({"sha": sha, "message": f"feat: {step['goal']}"})

    # 3. Push to local "remote" (always — even with no new commits this round,
    # we may need to push state from a prior round that was rolled back).
    branch = _git(repo_dir, "rev-parse", "--abbrev-ref", "HEAD").strip()
    try:
        _git(repo_dir, "push", "origin", branch, "--force")
    except subprocess.CalledProcessError as e:
        return {"summary": f"push failed: {e}", "branch": branch, "commits": commits,
                "tests_added": [], "files_changed": []}

    return {
        "branch": branch,
        "commits": commits,
        "tests_added": [str(test_path.relative_to(repo_dir))] if not skip_test else [],
        "files_changed": [str(src_path.relative_to(repo_dir))],
        "summary": f"Implemented {fn}() (skip_test={skip_test}, skip_feat={skip_feat})",
    }


def _stub_reviewer(workspace: Path, user_prompt: str) -> dict:
    """Deterministic reviewer: greps commits on the branch for `test:` and `feat:`
    prefixes; rejects if either is missing or if forbidden paths are touched."""
    repo_dir = workspace / "repo"
    if not repo_dir.exists():
        return {"verdict": "request_changes", "comments": [{"msg": "repo missing"}], "summary": "no repo"}

    base = os.getenv("GITHUB_DEFAULT_BRANCH", "main")
    try:
        log = _git(repo_dir, "log", f"{base}..HEAD", "--pretty=format:%H %s")
    except subprocess.CalledProcessError:
        log = _git(repo_dir, "log", "-n", "10", "--pretty=format:%H %s")

    has_test = bool(re.search(r"^[0-9a-f]+ test:", log, re.M))
    has_feat = bool(re.search(r"^[0-9a-f]+ feat:", log, re.M))
    comments = []
    if not has_test:
        comments.append({"file": ".", "line": 0, "category": "tdd", "msg": "no `test:`-prefixed commit on branch"})
    if not has_feat:
        comments.append({"file": ".", "line": 0, "category": "tdd", "msg": "no `feat:`-prefixed commit on branch"})

    try:
        diff_files = _git(repo_dir, "diff", "--name-only", f"{base}..HEAD").splitlines()
    except subprocess.CalledProcessError:
        diff_files = []
    forbidden = re.compile(r"^(\.github/|Dockerfile|docker-compose\.yml|.*\.lock|\.env)")
    bad = [f for f in diff_files if forbidden.match(f)]
    for f in bad:
        comments.append({"file": f, "line": 0, "category": "scope", "msg": "forbidden path touched"})

    verdict = "approve" if not comments else "request_changes"
    return {
        "verdict": verdict,
        "comments": comments,
        "summary": f"{verdict}: tdd={has_test and has_feat}, forbidden={len(bad)}",
    }


def _stub_guardian(metrics: dict) -> dict:
    """Deterministic guardian for LOCAL_MODE. Looks at signals that survived
    the API-key→subscription transition: CI failure rate is still meaningful;
    daily-USD-budget is not (subscription doesn't bill per USD)."""
    health = 100
    alerts: list[dict] = []
    rec = "continue"
    if metrics.get("ci_failures_last_hour", 0) >= 5:
        health -= 25
        alerts.append({"level": "warn", "topic": "ci_failure_rate",
                       "detail": ">=5 CI failures/hour"})
        rec = "pause"
    if metrics.get("rate_limited", False):
        health -= 15
        alerts.append({"level": "warn", "topic": "rate_limit",
                       "detail": "RATE_LIMITED flag is active"})
    return {
        "health": health,
        "alerts": alerts,
        "recommendation": rec,
        "summary": f"health={health}, rec={rec}",
    }


def _git(cwd: Path, *args: str) -> str:
    out = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "GIT_AUTHOR_NAME": "auto-evo-bot", "GIT_AUTHOR_EMAIL": "bot@local",
             "GIT_COMMITTER_NAME": "auto-evo-bot", "GIT_COMMITTER_EMAIL": "bot@local"},
    )
    if out.returncode != 0:
        raise subprocess.CalledProcessError(out.returncode, out.args, output=out.stdout, stderr=out.stderr)
    return out.stdout


def run_role_local(role: str, issue_id: int, user_prompt: str,
                   extra_volumes: Optional[dict] = None,
                   workspace: Optional[Path] = None,
                   plan: Optional[dict] = None) -> dict:
    """Local-mode runner. Returns the same dict shape as runner.run_role."""
    workspace = workspace or (WORKSPACE_ROOT / f"issue-{issue_id}")
    workspace.mkdir(parents=True, exist_ok=True)
    run_dir = workspace / f"{role}-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    run_dir.mkdir()
    (run_dir / "prompt.txt").write_text(user_prompt, encoding="utf-8")

    started = time.time()
    parsed: dict = {}
    exit_code = 0

    if _use_sdk():
        try:
            parsed = _call_anthropic_sdk(role, user_prompt, workspace, plan)
        except Exception as e:  # noqa: BLE001
            parsed = {"error": str(e), "summary": f"sdk failure: {e}"}
            exit_code = 1
    else:
        if role == "planner":
            parsed = _stub_planner(workspace, user_prompt)
        elif role == "coder":
            parsed = _stub_coder(workspace, user_prompt, plan or {})
        elif role == "reviewer":
            parsed = _stub_reviewer(workspace, user_prompt)
        elif role == "guardian":
            try:
                metrics = json.loads(Path("/state/metrics.json").read_text())
            except Exception:
                metrics = {}
            parsed = _stub_guardian(metrics)
        else:
            parsed = {"error": f"unknown role {role}"}
            exit_code = 2

    finished = time.time()
    parsed.setdefault("usage", {"input_tokens": 0, "output_tokens": 0})

    # Persist for debugging.
    (run_dir / "result.json").write_text(json.dumps(parsed, ensure_ascii=False, indent=2))

    in_tok = int(parsed.get("usage", {}).get("input_tokens", 0))
    out_tok = int(parsed.get("usage", {}).get("output_tokens", 0))
    model = os.getenv({
        "planner": "PLANNER_MODEL",
        "coder": "CODER_MODEL",
        "reviewer": "REVIEWER_MODEL",
        "guardian": "GUARDIAN_MODEL",
    }[role], "claude-sonnet-4-6")
    cost = parsed.get("cost_usd", _cost_estimate(model, in_tok, out_tok))

    return {
        "exit_code": exit_code,
        "result": parsed,
        "cost_usd": cost,
        "run_dir": str(run_dir),
        "in_tokens": in_tok,
        "out_tokens": out_tok,
    }


def _call_anthropic_sdk(role: str, user_prompt: str, workspace: Path, plan: Optional[dict]) -> dict:
    """Direct SDK call. No tool use — model returns text we then post-process by role.

    For Coder we currently fall back to the stub even when a real key is present,
    because doing real TDD requires the full Claude Code agent loop with tool use,
    which is out of scope for local mode (use Docker path instead). We document
    this clearly."""
    import anthropic

    if role == "coder":
        # Real coder needs Claude Code agent loop (Edit/Write/Bash). Fall back to
        # deterministic stub so the rest of the pipeline can still be tested.
        return _stub_coder(workspace, user_prompt, plan or {})

    client = anthropic.Anthropic()
    system_prompt = (PROMPT_DIR / f"{role}.md").read_text(encoding="utf-8")
    model_env = {
        "planner": "PLANNER_MODEL",
        "reviewer": "REVIEWER_MODEL",
        "guardian": "GUARDIAN_MODEL",
    }[role]
    model = os.getenv(model_env, "claude-sonnet-4-6")

    msg = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt + "\n\nReturn ONLY a JSON object matching the schema in the system prompt. No prose.",
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = "".join(b.text for b in msg.content if hasattr(b, "text"))
    # Strip ```json fences if present.
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = {"raw_text": text[:4000], "summary": "SDK returned non-JSON"}
    parsed["usage"] = {
        "input_tokens": msg.usage.input_tokens,
        "output_tokens": msg.usage.output_tokens,
    }
    return parsed
