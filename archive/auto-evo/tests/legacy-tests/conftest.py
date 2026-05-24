"""Shared test fixtures.

Tests must run cleanly without an internet connection, without Docker, and
without modifying the real `reports/` / `tasks/` / `commands/` of the repo.
Most tests use `tmp_path` and pass explicit paths into the AutoDev modules
(every module accepts an override). The few tests that need to land things
inside the repo run against a private tmpdir tree mirroring the layout.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest

# Make the repo importable when pytest is run from any cwd.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

# FAIL-0009 working fix (Cycle 33): the cli-executor's `_log()` writes
# to the REAL reports/session-log.md every time `run_prompt()` is called.
# The unit tests in tests/test_autodev_claude_code_cli.py mock subprocess
# but still hit the real `_log()` path. Setting this env var at conftest
# import time (which pytest loads before collecting any test) makes every
# pytest run immune. Production cli executor calls run without pytest and
# never set this var, so audit logging continues normally.
os.environ.setdefault("AUTODEV_AUDIT_LOG_SUPPRESS", "1")


@pytest.fixture
def autodev_tmp_repo(tmp_path: Path, monkeypatch):
    """Provide a tmpdir tree shaped like a real AutoDev repo and point the
    library at it via env vars.  Returns the root Path."""
    for sub in ("reports", "tasks", "commands", "state"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    # Minimal seed files
    (tmp_path / "tasks" / "backlog.md").write_text(
        "# Backlog\n\n## P0\n\n- [ ] TASK-001: Test task :: test details\n"
    )
    (tmp_path / "tasks" / "current.md").write_text("# Current\n\nNo task.\n")
    (tmp_path / "tasks" / "done.md").write_text("# Done\n")
    (tmp_path / "tasks" / "blockers.md").write_text("# Blockers\n")
    (tmp_path / "commands" / "inbox.md").write_text(
        "# Inbox\n\n## Pending\n\n(empty)\n"
    )
    (tmp_path / "commands" / "processed.md").write_text("# Processed\n\n")
    (tmp_path / "reports" / "human-hold.md").write_text("# Human hold\n\n")
    (tmp_path / "reports" / "session-log.md").write_text("# Session log\n")
    (tmp_path / "reports" / "decisions.md").write_text("# Decisions\n")
    monkeypatch.setenv("AUTODEV_REPORTS_DIR", str(tmp_path / "reports"))
    # The other path helpers consult `__file__`-relative project roots;
    # we patch them with monkeypatch in each test that needs it.
    return tmp_path
