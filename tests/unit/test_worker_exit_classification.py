"""BR-003 — classify a phase failure into one of the canonical labels.

The classifier reads what we already know about a failed subprocess
(phase, exit_code, stderr tail, the command line we ran) and returns
the most specific label. This is heuristic — when in doubt, return
``unknown_failure`` rather than guessing wrong.
"""
from __future__ import annotations

import pytest

from orchestrator.worker_exits import classify_failure


def test_pytest_failure_classified_as_test_failure() -> None:
    assert classify_failure(
        phase="tests", exit_code=1,
        command="python -m pytest -q",
        stderr_tail="3 failed in 0.42s",
    ) == "test_failure"


def test_ruff_failure_classified_as_lint_failure() -> None:
    assert classify_failure(
        phase="lint", exit_code=1,
        command="ruff check .",
        stderr_tail="Found 4 errors.",
    ) == "lint_failure"


def test_build_failure() -> None:
    assert classify_failure(
        phase="build", exit_code=2,
        command="python -m build",
        stderr_tail="error: command failed",
    ) == "build_failure"


def test_claude_cli_nonzero_classified_as_claude_cli_failure() -> None:
    assert classify_failure(
        phase="coder", exit_code=1,
        command="claude --print 'plan'",
        stderr_tail="api error: 500",
    ) == "claude_cli_failure"


def test_auth_error_classified_as_auth_failure() -> None:
    assert classify_failure(
        phase="prepare", exit_code=1,
        command="claude --print 'ping'",
        stderr_tail="authentication required",
    ) == "auth_failure"
    assert classify_failure(
        phase="prepare", exit_code=1,
        command="gh auth status",
        stderr_tail="not authenticated",
    ) == "auth_failure"


def test_gh_failure_classified_as_github_failure() -> None:
    assert classify_failure(
        phase="open_pr", exit_code=1,
        command="gh pr create",
        stderr_tail="HTTP 403: insufficient scope",
    ) == "github_failure"


def test_git_failure_classified_as_git_failure() -> None:
    assert classify_failure(
        phase="push", exit_code=128,
        command="git push origin agent/foo",
        stderr_tail="remote: Permission to repo denied",
    ) == "git_failure"


def test_docker_failure_classified_as_docker_failure() -> None:
    assert classify_failure(
        phase="prepare_workspace", exit_code=1,
        command="docker run runner:latest",
        stderr_tail="Cannot connect to the Docker daemon",
    ) == "docker_failure"


def test_timeout_explicit() -> None:
    assert classify_failure(
        phase="tests", exit_code=124,
        command="pytest",
        stderr_tail="TIMEOUT after 900s",
    ) == "timeout"


def test_merge_policy_block_label_returned_when_phase_is_merge_policy() -> None:
    """The merge_policy phase doesn't run a subprocess; it returns a
    decision. We still record it as a phase end. classify_failure
    must understand the merge_policy phase even with exit_code=0."""
    assert classify_failure(
        phase="merge_policy", exit_code=0,
        command="merge_policy.decide",
        stderr_tail=None,
        verdict="BLOCKED",
    ) == "merge_policy_block"


def test_validator_failure_label() -> None:
    assert classify_failure(
        phase="validate", exit_code=1,
        command="gemini judge",
        stderr_tail="rate limited",
    ) == "validator_failure"


def test_success_when_exit_code_zero_and_no_signal() -> None:
    assert classify_failure(
        phase="tests", exit_code=0,
        command="pytest",
        stderr_tail="",
    ) == "success"


def test_unknown_failure_default() -> None:
    assert classify_failure(
        phase="something_else", exit_code=99,
        command="weird",
        stderr_tail="strange noise",
    ) == "unknown_failure"
