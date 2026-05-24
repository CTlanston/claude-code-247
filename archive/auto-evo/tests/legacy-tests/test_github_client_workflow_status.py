"""Regression tests for FAIL-0005 (Cycle 45 empirical reproduction).

FAIL-0005 symptom (V3 E2E, 2026-05-11): when PyGithub's `_gh()` raised
IndexError or GithubException during `latest_workflow_run_status`, the
exception propagated out of `main_oneshot`, freezing the inner-engine
loop for ALL queued issues.

V3-era "Working fix" (commit 9df48f6): wrap the call site in
`try / except Exception`, log a warning, return None.

Cycle 45 empirical finding: the V3 fix shipped with a latent
NameError — the `except Exception as e:` branch calls
`log.warning(...)` but the bare name `log` was never imported or
defined at module scope. The "defensive" path itself raised
NameError, which propagated and reproduced the original symptom.
This file pins both the symptom (function returns None on
PyGithub failure) AND the latent-bug guard (no NameError in the
except branch).

Tests mock `_gh()` and `_local_mode()` directly — no PyGithub
install required, no network.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from orchestrator import github_client


class _FakeRuns:
    """Minimal PyGithub PaginatedList double — supports
    `.totalCount` and `runs[:1]` slice iteration."""

    def __init__(self, items=None, total=None, total_raises=False, slice_raises=None):
        self._items = items or []
        self._total = total
        self._total_raises = total_raises
        self._slice_raises = slice_raises

    @property
    def totalCount(self):  # noqa: N802 (matches PyGithub camelCase)
        if self._total_raises:
            raise RuntimeError("PyGithub totalCount failure")
        return self._total if self._total is not None else len(self._items)

    def __getitem__(self, key):
        if self._slice_raises is not None:
            raise self._slice_raises
        return self._items[key]


def _patch_remote_mode(monkeypatch):
    """Force `latest_workflow_run_status` into the non-local
    code path so the defensive try/except is actually exercised."""
    monkeypatch.setattr(github_client, "_local_mode", lambda: False)


def test_indexerror_in_runs_subscript_returns_none(monkeypatch):
    """Empirical reproduction of FAIL-0005's symptom: an IndexError
    inside the try block must NOT propagate. Pre-Cycle-45 this test
    fails with NameError because `log` is undefined in the except
    branch."""
    _patch_remote_mode(monkeypatch)
    fake_repo = MagicMock()
    fake_repo.get_workflow_runs.return_value = _FakeRuns(
        items=[], total=1, slice_raises=IndexError("PaginatedList empty")
    )
    monkeypatch.setattr(github_client, "_gh", lambda: fake_repo)

    result = github_client.latest_workflow_run_status("shadow/issue-99")

    assert result is None


def test_generic_exception_in_get_workflow_runs_returns_none(monkeypatch):
    """A generic exception from `_gh()` (transient API hiccup,
    auth glitch, etc.) must be swallowed."""
    _patch_remote_mode(monkeypatch)

    def _exploding_gh():
        raise RuntimeError("simulated GithubException")

    monkeypatch.setattr(github_client, "_gh", _exploding_gh)

    result = github_client.latest_workflow_run_status("shadow/issue-99")

    assert result is None


def test_totalcount_exception_does_not_crash(monkeypatch):
    """Defensive nested try around `runs.totalCount` must catch."""
    _patch_remote_mode(monkeypatch)
    fake_repo = MagicMock()
    fake_repo.get_workflow_runs.return_value = _FakeRuns(
        items=[_RunDouble("success")], total_raises=True
    )
    monkeypatch.setattr(github_client, "_gh", lambda: fake_repo)

    result = github_client.latest_workflow_run_status("shadow/issue-1")

    # totalCount raises → swallowed → falls through to runs[:1]
    # iteration which yields the success run.
    assert result == "success"


def test_totalcount_zero_returns_none(monkeypatch):
    """The early-return for empty workflow lists."""
    _patch_remote_mode(monkeypatch)
    fake_repo = MagicMock()
    fake_repo.get_workflow_runs.return_value = _FakeRuns(items=[], total=0)
    monkeypatch.setattr(github_client, "_gh", lambda: fake_repo)

    assert github_client.latest_workflow_run_status("shadow/issue-99") is None


def test_success_conclusion_returned(monkeypatch):
    """Happy path — non-zero workflow runs return the conclusion."""
    _patch_remote_mode(monkeypatch)
    fake_repo = MagicMock()
    fake_repo.get_workflow_runs.return_value = _FakeRuns(
        items=[_RunDouble("success")], total=1
    )
    monkeypatch.setattr(github_client, "_gh", lambda: fake_repo)

    assert github_client.latest_workflow_run_status("main") == "success"


def test_none_conclusion_means_running(monkeypatch):
    """`run.conclusion` is None while the workflow is still in
    progress — function returns 'running'."""
    _patch_remote_mode(monkeypatch)
    fake_repo = MagicMock()
    fake_repo.get_workflow_runs.return_value = _FakeRuns(
        items=[_RunDouble(None)], total=1
    )
    monkeypatch.setattr(github_client, "_gh", lambda: fake_repo)

    assert github_client.latest_workflow_run_status("main") == "running"


def test_module_has_log_logger_defined():
    """The latent-bug guard: the `log` name referenced in the
    except branch must exist at module scope. Without this fix the
    `log.warning(...)` call raises NameError and reproduces
    FAIL-0005 by a different code path."""
    import logging

    assert hasattr(github_client, "log"), (
        "orchestrator.github_client.log must be defined "
        "(referenced in latest_workflow_run_status except branch)"
    )
    assert isinstance(github_client.log, logging.Logger)


class _RunDouble:
    """PyGithub WorkflowRun double — exposes `.conclusion`."""

    def __init__(self, conclusion):
        self.conclusion = conclusion
