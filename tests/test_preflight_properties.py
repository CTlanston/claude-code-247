"""Hypothesis property tests for orchestrator.preflight.

Module 2/3 toward T-dim L4. Tests the V4 issue-preflight gate.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pytest

hypothesis = pytest.importorskip("hypothesis")
from hypothesis import given, settings, strategies as st  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
import preflight  # noqa: E402


# Strategies:
# - title text: short-ish, includes some realistic punctuation
# - body text: longer, can include backticks, paths, forbidden phrases
# - repo_root: a real tmp_path-shaped Path created per test

TITLE = st.text(alphabet=st.characters(min_codepoint=0x20, max_codepoint=0x7e),
                max_size=200)
BODY = st.text(alphabet=st.characters(min_codepoint=0x20, max_codepoint=0x7e),
               max_size=2000)


# Module-level empty repo. preflight_issue is read-only on the filesystem,
# so a single shared tmpdir is safe across all generated inputs. Using
# pytest's function-scoped tmp_path inside @given trips Hypothesis's
# health check.
_MOD_ROOT = Path(tempfile.mkdtemp(prefix="preflight_props_"))
(_MOD_ROOT / "src").mkdir(exist_ok=True)


def _empty_repo() -> Path:
    return _MOD_ROOT


@given(title=TITLE, body=BODY)
@settings(max_examples=100)
def test_preflight_always_returns_result_type(title, body):
    """preflight_issue never raises for any text input."""
    root = _empty_repo()
    result = preflight.preflight_issue(title, body, root)
    assert isinstance(result, preflight.PreflightResult)


@given(title=TITLE, body=BODY)
def test_preflight_ok_implies_no_terminal_status(title, body):
    """ok=True ⇒ terminal_status is None (cannot terminalise an OK plan)."""
    root = _empty_repo()
    result = preflight.preflight_issue(title, body, root)
    if result.ok:
        assert result.terminal_status is None
        assert result.reason == ""


@given(title=TITLE, body=BODY)
def test_preflight_not_ok_implies_reason_and_terminal(title, body):
    """ok=False ⇒ non-empty reason AND terminal_status set."""
    root = _empty_repo()
    result = preflight.preflight_issue(title, body, root)
    if not result.ok:
        assert result.terminal_status is not None
        assert result.reason  # non-empty string


@given(title=TITLE, body=BODY)
def test_preflight_idempotent(title, body):
    """Same inputs → structurally equal result on repeat call."""
    root = _empty_repo()
    r1 = preflight.preflight_issue(title, body, root)
    r2 = preflight.preflight_issue(title, body, root)
    assert r1.ok == r2.ok
    assert r1.terminal_status == r2.terminal_status
    assert r1.reason == r2.reason
    assert sorted(r1.detected_symbols) == sorted(r2.detected_symbols)
    assert sorted(r1.detected_files) == sorted(r2.detected_files)
    assert sorted(r1.forbidden_files) == sorted(r2.forbidden_files)


@given(title=TITLE, body=BODY)
@settings(max_examples=100)
def test_detected_symbols_are_subset_of_input_text(title, body):
    """Every detected symbol must appear in title+body lowercased."""
    root = _empty_repo()
    result = preflight.preflight_issue(title, body, root)
    text = f"{title}\n{body}".lower()
    for sym in result.detected_symbols:
        assert sym in text, f"symbol {sym!r} not found in input text"


@given(title=TITLE, body=BODY)
@settings(max_examples=100)
def test_detected_files_are_subset_of_input_text(title, body):
    """Every detected file path must appear in title+body."""
    root = _empty_repo()
    result = preflight.preflight_issue(title, body, root)
    text = f"{title}\n{body}"
    for f in result.detected_files:
        assert f in text


@given(body=BODY)
def test_no_forbidden_file_means_ok(body):
    """If the input doesn't trigger any forbidden_files, preflight passes."""
    root = _empty_repo()
    # Strip any forbidden-modification phrases to ensure no src/lib/orchestrator
    # path can be flagged as forbidden.
    cleaned = body
    for p in ["do not modify", "do not edit", "must not modify",
              "without modifying", "no source mod", "no modification of",
              "不要修改", "禁止修改", "不修改", "不能修改"]:
        cleaned = cleaned.replace(p, "")
    result = preflight.preflight_issue("title", cleaned, root)
    # forbidden_files restricted to src/lib/orchestrator paths; without
    # any such match-from-window, src_forbidden is empty and we return ok=True.
    src_forbidden = [f for f in result.forbidden_files
                     if f.startswith(("src/", "lib/", "orchestrator/"))]
    if not src_forbidden:
        assert result.ok is True


def test_concrete_impossible_spec_returns_failed():
    """Anchor: the V3 #15 pattern must terminalise."""
    root = Path(__file__).parent / "_tmp_preflight_anchor"
    root.mkdir(exist_ok=True)
    (root / "src").mkdir(exist_ok=True)
    (root / "src" / "utils.py").write_text(
        "def chunks(s, n):\n    return [s[i:i+n] for i in range(0, len(s), n)]\n"
    )
    try:
        result = preflight.preflight_issue(
            title="Add tests for `reverse()` in src/utils.py",
            body=("Write tests for `reverse(s)`. "
                  "Do not modify `src/utils.py`."),
            repo_root=root,
        )
        assert result.ok is False
        assert result.terminal_status == "failed"
        assert "reverse" in result.reason.lower() or "blocked" in result.reason.lower()
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)


def test_concrete_possible_spec_returns_ok():
    """Anchor: a normal feature spec passes through."""
    root = Path(__file__).parent / "_tmp_preflight_anchor2"
    root.mkdir(exist_ok=True)
    (root / "src").mkdir(exist_ok=True)
    try:
        result = preflight.preflight_issue(
            title="Add a new `multiply(a, b)` utility",
            body="Add multiply(a, b) to src/math.py with tests.",
            repo_root=root,
        )
        assert result.ok is True
        assert result.terminal_status is None
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)
