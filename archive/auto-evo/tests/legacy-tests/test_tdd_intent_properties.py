"""Hypothesis property tests for orchestrator.main._check_tdd_invariant.

Module 3/3 toward T-dim L4. Tests the V4 TDD-intent gate that replaced
V3's strict per-commit ordering rule.

Uses unittest.mock.patch to swap git_proxy.commit_log with a stub that
returns Hypothesis-generated commit lists, so we can property-test the
pure logic without an actual git repo.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

hypothesis = pytest.importorskip("hypothesis")
from hypothesis import given, settings, strategies as st  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import main as orchestrator_main  # noqa: E402


# Commit-subject strategies. Real git subjects are <= 100 chars typically.
TEST_PREFIX = st.sampled_from(["test:", "tests:", "spec:", "specs:",
                               "coverage:", "TEST:", "Test:", "Tests:"])
IMPL_PREFIX = st.sampled_from(["feat:", "fix:", "impl:", "implement:",
                               "refactor:", "FEAT:", "Fix:"])
OTHER_PREFIX = st.sampled_from(["chore:", "docs:", "ci:", "build:",
                                 "style:", "perf:"])

SUBJECT_TEXT = st.text(alphabet=st.characters(min_codepoint=0x20,
                                                max_codepoint=0x7e),
                        min_size=1, max_size=80)


def _make_commit(subject: str) -> dict:
    """Construct a commit dict matching what git_proxy.commit_log returns."""
    return {"subject": subject, "sha": "abc1234", "author_date": 0}


def _test_subject(suffix: str) -> str:
    return f"test: {suffix.strip() or 'thing'}"


def _impl_subject(suffix: str) -> str:
    return f"feat: {suffix.strip() or 'thing'}"


def _other_subject(suffix: str) -> str:
    return f"chore: {suffix.strip() or 'thing'}"


def _call_check(commit_subjects_oldest_first):
    """Call _check_tdd_invariant with mocked git_proxy.commit_log.

    Important: commit_log returns NEWEST-first (git log default). The
    function reverses internally. So we pass NEWEST-first to the mock.
    """
    newest_first = list(reversed(commit_subjects_oldest_first))
    commits = [_make_commit(s) for s in newest_first]
    # Patch where main.py looks it up
    with patch.object(orchestrator_main.git_proxy, "commit_log",
                       return_value=commits):
        return orchestrator_main._check_tdd_invariant(issue_id=1)


# --- Property tests --------------------------------------------------------


def test_empty_commit_list_returns_no_commits_message():
    """Anchor: empty list → 'no commits on shadow branch'."""
    result = _call_check([])
    assert result == "no commits on shadow branch"


@given(other_subjects=st.lists(st.text(min_size=1, max_size=20),
                                 min_size=1, max_size=10))
def test_only_other_commits_fails(other_subjects):
    """Only chore/docs/etc with no test or impl → fails."""
    subjects = [_other_subject(s) for s in other_subjects]
    result = _call_check(subjects)
    # No test commits → "no test/spec commits..."
    assert result is not None
    assert "test" in result.lower() or "spec" in result.lower()


@given(test_suffixes=st.lists(SUBJECT_TEXT, min_size=1, max_size=10),
       impl_suffixes=st.lists(SUBJECT_TEXT, min_size=1, max_size=10))
@settings(max_examples=100)
def test_test_before_impl_passes(test_suffixes, impl_suffixes):
    """At least one test commit before at least one impl commit → passes."""
    oldest_first = (
        [_test_subject(s) for s in test_suffixes]
        + [_impl_subject(s) for s in impl_suffixes]
    )
    result = _call_check(oldest_first)
    assert result is None, (
        f"Expected None for {len(test_suffixes)} test → {len(impl_suffixes)} impl, "
        f"got {result!r}"
    )


@given(test_suffixes=st.lists(SUBJECT_TEXT, min_size=1, max_size=10),
       impl_suffixes=st.lists(SUBJECT_TEXT, min_size=1, max_size=10))
@settings(max_examples=100)
def test_all_impl_before_all_test_fails(test_suffixes, impl_suffixes):
    """All impl commits BEFORE all test commits → fails ("tests after impl")."""
    oldest_first = (
        [_impl_subject(s) for s in impl_suffixes]
        + [_test_subject(s) for s in test_suffixes]
    )
    result = _call_check(oldest_first)
    assert result is not None
    assert "test" in result.lower() or "after" in result.lower()


@given(prefix=st.one_of(TEST_PREFIX, IMPL_PREFIX, OTHER_PREFIX),
       suffix=SUBJECT_TEXT)
def test_idempotent_single_commit(prefix, suffix):
    """Same commit list → same result on repeat call."""
    subject = f"{prefix} {suffix.strip() or 'thing'}"
    r1 = _call_check([subject])
    r2 = _call_check([subject])
    assert r1 == r2


@given(test_count=st.integers(min_value=1, max_value=5),
       impl_count=st.integers(min_value=1, max_value=5),
       trailing_test_count=st.integers(min_value=1, max_value=5))
def test_trailing_edge_case_test_after_impl_passes(
        test_count, impl_count, trailing_test_count):
    """V4 softening anchor (covers the FAIL-0001 pattern): the V3 #14
    sequence (test → ... → impl → ... → trailing edge-case test) should
    pass under the V4 intent gate."""
    oldest_first = (
        [_test_subject(f"head-{i}") for i in range(test_count)]
        + [_impl_subject(f"body-{i}") for i in range(impl_count)]
        + [_test_subject(f"tail-{i}") for i in range(trailing_test_count)]
    )
    result = _call_check(oldest_first)
    assert result is None, (
        f"V3 #14 pattern should pass; got {result!r}"
    )


def test_concrete_v3_14_pattern_passes():
    """Anchor: the exact V3 #14 commit history must pass."""
    subjects_oldest_first = [
        "test: add chunks tests",
        "feat: implement chunks",
        "test: add edge-case empty-input test",
    ]
    result = _call_check(subjects_oldest_first)
    assert result is None
