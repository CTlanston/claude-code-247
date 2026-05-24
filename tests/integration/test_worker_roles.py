"""Worker end-to-end with a fake `claude` CLI on PATH.

We drop a stub `claude` binary into a tmp dir, prepend it to PATH, and
exercise the runner_manager → runner.worker → role_loop chain so the
flow holds together as a system. The stub writes contract / plan /
worker_done / review files on its first invocation per role and prints
JSON to stdout, just like the real CLI.
"""
from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import pytest
import yaml

from memory.db import init_db
from orchestrator.repo_registry import parse_registry, sync_to_db
from orchestrator.runner_manager import RunnerManager


def _write_fake_claude(dest: Path) -> Path:
    """A fake `claude` that introspects argv to detect role and produces
    the right evidence file each time."""
    bin_path = dest / "claude"
    # The fake parses --append-system-prompt to grep for "Role: Planner"
    # etc., and looks for a workspace via PWD (the runner_manager passes
    # cwd=workspace to subprocess so PWD is the workspace).
    bin_path.write_text(r"""#!/usr/bin/env python3
import json, os, sys, pathlib

argv = sys.argv[1:]
# Find --append-system-prompt's value
sysprompt = ""
for i, a in enumerate(argv):
    if a == "--append-system-prompt" and i + 1 < len(argv):
        sysprompt = argv[i + 1]
        break

role = "unknown"
for needle, name in (("Role: Planner", "planner"),
                     ("Role: Coder", "coder"),
                     ("Role: Reviewer", "reviewer"),
                     ("Role: Repair", "repair")):
    if needle in sysprompt:
        role = name
        break

ws = pathlib.Path(os.getcwd())
ev = ws / ".evidence"
ev.mkdir(parents=True, exist_ok=True)

if role == "planner":
    (ev / "contract.md").write_text("# Contract\nDeliver feature X with tests.\n")
    (ev / "plan.md").write_text("# Plan\n- write feature\n- write test\n")
    (ev / "risk_assessment.md").write_text("low risk\n")
    (ev / "worker_breakdown.md").write_text("one chunk\n")
elif role == "coder":
    (ev / "worker_done.md").write_text("ok\n")
elif role == "reviewer":
    (ev / "review.md").write_text("VERDICT: PASS\n\nLooks fine.\n")

print(json.dumps({"result": f"{role} done",
                   "usage": {"input_tokens": 5, "output_tokens": 5},
                   "total_cost_usd": None}))
""")
    bin_path.chmod(bin_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return bin_path


@pytest.fixture
def claude_on_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    binsdir = tmp_path / "bin"
    binsdir.mkdir()
    fake = _write_fake_claude(binsdir)
    monkeypatch.setenv("PATH", f"{binsdir}:{os.environ.get('PATH', '')}")
    return fake


def _seed(fake_repo: Path) -> None:
    repos_path = Path(os.environ["CLAUDE247_REPOS_FILE"])
    repos_path.write_text(yaml.safe_dump({"repos": [{
        "id": "rolesdemo",
        "github_owner": "owner",
        "github_repo": "demo-repo",
        "local_path": str(fake_repo),
        "default_branch": "main",
        "forbidden_paths": [".env"],
        "test_commands": [f"{sys.executable} -m pytest -q"],
        "lint_commands": [],
        "build_commands": [],
    }]}))
    init_db()
    sync_to_db(parse_registry(repos_path.read_text()))


def test_worker_runs_role_loop_to_pass(fake_repo: Path, claude_on_path: Path) -> None:
    _seed(fake_repo)
    rm = RunnerManager(backend="local")
    prep = rm.prepare_workspace(task_id="rt001", repo_id="rolesdemo", goal="add greet")
    spec = rm.build_task_spec(task_id="rt001", repo=rm.get_repo("rolesdemo"),
                              goal="add greet", branch=prep.branch)
    outcome = rm.run(prep=prep, spec=spec, allow_roles=True)
    # Should pass: all three role steps complete and reviewer says PASS.
    assert outcome.exit_code == 0, outcome.stderr or outcome.stdout
    ev = prep.workspace / ".evidence"
    assert (ev / "contract.md").exists()
    assert (ev / "review.md").exists()
    review = (ev / "review.md").read_text()
    assert review.startswith("VERDICT: PASS")
    worker_done = json.loads(_extract_json(ev / "worker_done.md"))
    assert worker_done["ok"] is True
    assert worker_done["role_loop"]["final_verdict"] == "PASS"


def _extract_json(p: Path) -> str:
    body = p.read_text()
    # body is markdown with a ```json fenced block — pull it out
    start = body.find("```json")
    assert start >= 0
    end = body.find("```", start + 7)
    return body[start + 7:end].strip()
