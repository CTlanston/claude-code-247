"""Regression tests for V4 hardening (4 tracks).

Every behavior change in `prompts/v4-hardening.md` has a test here so that
future regressions trip CI before they trip a live driver session.

Tracks covered:
  T1 — orchestrator/billable.py + orchestrator/db.py record_run cost masking
  T2 — orchestrator/preflight.py impossible-spec detection
  T3 — orchestrator/main.py:_check_tdd_invariant V4 intent policy
  T4 — autodev/supervisor.py:_inner_engine_has_pending_work STATE_DIR honour
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
# orchestrator/main.py uses bare imports (`import circuit_breaker as cb`)
# that assume cwd=orchestrator/. Adding that dir to path so the tests in
# this file can import orchestrator.main without triggering the bare-import
# explosion. This is a test-only workaround — the inner-engine module
# structure is the inner-engine team's problem to refactor.
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))

# orchestrator/main.py also runs `STATE_DIR.mkdir()` at module-import time.
# Default STATE_DIR is /state (read-only on macOS hosts). Point it at the
# project-local state dir before any import happens.
os.environ.setdefault("STATE_DIR", str(REPO_ROOT / "state"))


# ============================================================================
# Track 1 — billable cost helpers + db.record_run integration
# ============================================================================


def test_billable_is_subscription_mode_oat_token(monkeypatch):
    from orchestrator import billable
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-deadbeef")
    assert billable.is_subscription_mode() is True


def test_billable_is_subscription_mode_oauth_env(monkeypatch):
    from orchestrator import billable
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "anything")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert billable.is_subscription_mode() is True


def test_billable_api_mode_when_api_key(monkeypatch):
    from orchestrator import billable
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-something")
    assert billable.is_subscription_mode() is False


def test_billable_to_billable_cost_subscription_zeros_real_cost(monkeypatch):
    from orchestrator import billable
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-x")
    # Even with real tokens and a $5 estimate, subscription billable = 0.
    assert billable.to_billable_cost(5.0, in_tokens=1000, out_tokens=500) == 0.0


def test_billable_to_billable_cost_api_mode_passes_through(monkeypatch):
    from orchestrator import billable
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-x")
    assert billable.to_billable_cost(1.23, in_tokens=100, out_tokens=50) == 1.23


def test_billable_zero_token_zero_cost_regardless_of_mode(monkeypatch):
    from orchestrator import billable
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-x")
    # 0 tokens → 0 cost even in API mode (V3 Fix 1 preserved).
    assert billable.to_billable_cost(0.42, in_tokens=0, out_tokens=0) == 0.0


def test_billable_load_budget_metrics_subscription(monkeypatch, tmp_path):
    from orchestrator import billable
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-x")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    # Seed a DB with $99 of "real" cost
    db_path = tmp_path / "orchestrator.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute("CREATE TABLE metrics (bucket_at INTEGER PRIMARY KEY, "
                  "token_total INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0)")
        import time
        bucket = int(time.time() // 300)
        c.execute("INSERT INTO metrics(bucket_at, token_total, cost_usd) "
                  "VALUES (?, 1000, 99.0)", (bucket,))
    m = billable.load_budget_metrics(tmp_path)
    assert m["is_subscription"] is True
    assert m["daily_cost_usd"] == 0.0   # subscription mask hides the $99


def test_billable_load_budget_metrics_api_mode(monkeypatch, tmp_path):
    from orchestrator import billable
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-x")
    db_path = tmp_path / "orchestrator.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute("CREATE TABLE metrics (bucket_at INTEGER PRIMARY KEY, "
                  "token_total INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0)")
        import time
        bucket = int(time.time() // 300)
        c.execute("INSERT INTO metrics(bucket_at, token_total, cost_usd) "
                  "VALUES (?, 1000, 12.34)", (bucket,))
    m = billable.load_budget_metrics(tmp_path)
    assert m["is_subscription"] is False
    assert m["daily_cost_usd"] == 12.34   # API mode passes through


def test_db_record_run_zeros_cost_under_subscription(monkeypatch, tmp_path):
    """End-to-end: a real record_run under subscription mode writes cost=0
    even when the caller passes a non-zero estimate."""
    monkeypatch.setenv("STATE_DIR", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-x")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    # Re-import db so module-level STATE_DIR picks up the env override
    import importlib
    if "orchestrator.db" in sys.modules:
        importlib.reload(sys.modules["orchestrator.db"])
    from orchestrator import db
    db.init()
    db.record_run(
        issue_id=99, role="coder", started_at=1000.0, finished_at=1010.0,
        exit_code=0, in_tokens=500, out_tokens=300, cost=1.50,
        summary="test",
    )
    with sqlite3.connect(str(tmp_path / "orchestrator.db")) as c:
        row = c.execute(
            "SELECT cost_usd FROM runs WHERE issue_id=99 AND role='coder'"
        ).fetchone()
    assert row is not None
    assert row[0] == 0.0, f"expected cost zeroed under subscription; got {row[0]}"


def test_db_record_run_preserves_api_mode_cost(monkeypatch, tmp_path):
    """Under API mode, real cost passes through to the DB."""
    monkeypatch.setenv("STATE_DIR", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-real-key")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    import importlib
    if "orchestrator.db" in sys.modules:
        importlib.reload(sys.modules["orchestrator.db"])
    from orchestrator import db
    db.init()
    db.record_run(
        issue_id=100, role="planner", started_at=2000.0, finished_at=2005.0,
        exit_code=0, in_tokens=200, out_tokens=100, cost=0.07,
        summary="test",
    )
    with sqlite3.connect(str(tmp_path / "orchestrator.db")) as c:
        row = c.execute(
            "SELECT cost_usd FROM runs WHERE issue_id=100 AND role='planner'"
        ).fetchone()
    assert row is not None
    assert abs(row[0] - 0.07) < 1e-9


# ============================================================================
# Track 2 — preflight_issue impossible-spec detection
# ============================================================================


def test_preflight_impossible_spec_reverse_absent(tmp_path):
    """The canonical #15 pattern: issue wants tests for reverse(), src/utils.py
    is forbidden, and reverse() isn't in src/utils.py."""
    from orchestrator import preflight
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "utils.py").write_text('"""utils."""\n')  # no reverse()
    pf = preflight.preflight_issue(
        title="Cycle2: Add edge-case tests for reverse()",
        body=(
            "The `reverse(s)` function in `src/utils.py` currently has minimal "
            "test coverage. Add tests in `tests/test_reverse_edges.py` without "
            "modifying `src/utils.py`. Do NOT modify `src/utils.py` or existing tests."
        ),
        repo_root=tmp_path,
    )
    assert pf.ok is False
    assert pf.terminal_status == "failed"
    assert "blocked_impossible_spec" in pf.reason
    assert "reverse" in pf.detected_symbols


def test_preflight_ok_when_symbol_exists(tmp_path):
    """If reverse() IS in src/utils.py, the same issue body is fine."""
    from orchestrator import preflight
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "utils.py").write_text(
        '"""utils."""\n\ndef reverse(s):\n    return s[::-1]\n'
    )
    pf = preflight.preflight_issue(
        title="Cycle2: Add edge-case tests for reverse()",
        body="Add tests for reverse() in tests/. Do NOT modify src/utils.py.",
        repo_root=tmp_path,
    )
    assert pf.ok is True


def test_preflight_ok_when_no_forbidden_file(tmp_path):
    """If the issue doesn't forbid modifying anything in src/, we don't
    flag impossibility even if the function is missing — the Coder can
    just add it."""
    from orchestrator import preflight
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "utils.py").write_text('"""utils."""\n')
    pf = preflight.preflight_issue(
        title="Add chunks(items, n) utility",
        body="Add `chunks(items, n)` to `src/utils.py` and tests.",
        repo_root=tmp_path,
    )
    assert pf.ok is True   # creating a missing function is fine


def test_preflight_passes_unrelated_issue(tmp_path):
    """Issues that don't reference any source symbol are always ok."""
    from orchestrator import preflight
    pf = preflight.preflight_issue(
        title="Update docs",
        body="Add a paragraph about installation to README.md.",
        repo_root=tmp_path,
    )
    assert pf.ok is True


def test_preflight_only_flags_src_forbidden_not_test_forbidden(tmp_path):
    """If the issue forbids modifying tests/ (not src/), we don't flag
    impossibility even if the symbol is absent from src/."""
    from orchestrator import preflight
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "utils.py").write_text('"""utils."""\n')
    pf = preflight.preflight_issue(
        title="Add foo()",
        body="Add foo() to src/utils.py. Do not modify tests/test_existing.py.",
        repo_root=tmp_path,
    )
    assert pf.ok is True


# ============================================================================
# Track 3 — TDD-intent gate (replaces strict per-step ordering)
# ============================================================================


def test_tdd_intent_accepts_edge_case_test_after_impl(monkeypatch):
    """The V3 #14 symptom: an extra `test:` edge-case commit was added
    AFTER `feat:`. Under V4 intent policy, this is fine because at least
    one test commit STILL precedes at least one impl commit."""
    from orchestrator import main as orchestrator_main
    fake_commits = [   # newest first (git log default)
        {"sha": "e", "subject": "test: add negative-n edge case"},
        {"sha": "d", "subject": "feat: implement chunks()"},
        {"sha": "c", "subject": "test: add basic chunks() cases"},
    ]
    monkeypatch.setattr(orchestrator_main.git_proxy, "commit_log",
                        lambda issue_id, base=None: fake_commits)
    assert orchestrator_main._check_tdd_invariant(42) is None


def test_tdd_intent_rejects_no_tests(monkeypatch):
    from orchestrator import main as orchestrator_main
    monkeypatch.setattr(orchestrator_main.git_proxy, "commit_log", lambda issue_id, base=None: [
        {"sha": "b", "subject": "feat: implement chunks()"},
        {"sha": "a", "subject": "fix: handle n=0"},
    ])
    reason = orchestrator_main._check_tdd_invariant(42)
    assert reason is not None
    assert "test" in reason.lower()


def test_tdd_intent_rejects_all_tests_after_impl(monkeypatch):
    from orchestrator import main as orchestrator_main
    monkeypatch.setattr(orchestrator_main.git_proxy, "commit_log", lambda issue_id, base=None: [
        {"sha": "c", "subject": "test: add tests"},
        {"sha": "b", "subject": "feat: implement"},
        {"sha": "a", "subject": "feat: scaffold"},
    ])
    # oldest-first: scaffold(0), implement(1), test(2)
    # min test pos = 2; max impl pos = 1; 2 > 1 → reject
    reason = orchestrator_main._check_tdd_invariant(42)
    assert reason is not None
    assert "after all" in reason.lower()


def test_tdd_intent_accepts_one_pair(monkeypatch):
    from orchestrator import main as orchestrator_main
    monkeypatch.setattr(orchestrator_main.git_proxy, "commit_log", lambda issue_id, base=None: [
        {"sha": "b", "subject": "feat: implement"},
        {"sha": "a", "subject": "test: add tests"},
    ])
    # oldest-first: test(0), feat(1) → test precedes feat → ok
    assert orchestrator_main._check_tdd_invariant(42) is None


def test_tdd_intent_accepts_alternate_prefixes(monkeypatch):
    """spec/tests/coverage all count as test commits; fix/impl/refactor as impl."""
    from orchestrator import main as orchestrator_main
    monkeypatch.setattr(orchestrator_main.git_proxy, "commit_log", lambda issue_id, base=None: [
        {"sha": "c", "subject": "refactor: clean up internals"},
        {"sha": "b", "subject": "fix: handle empty list"},
        {"sha": "a", "subject": "spec: define behavior"},
    ])
    assert orchestrator_main._check_tdd_invariant(42) is None


# ============================================================================
# Track 4 — pending-work detection honors STATE_DIR
# ============================================================================


def test_pending_work_honors_state_dir_env(monkeypatch, tmp_path):
    """Helper must read DB at $STATE_DIR/orchestrator.db, not the hardcoded
    project-local path. With a custom STATE_DIR and a pending row there,
    helper returns True."""
    db_path = tmp_path / "orchestrator.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute("CREATE TABLE tasks ("
                  "issue_id INTEGER PRIMARY KEY, repo TEXT, status TEXT)")
        c.execute("INSERT INTO tasks VALUES (99, 'x', 'queued')")
    monkeypatch.setenv("STATE_DIR", str(tmp_path))
    monkeypatch.delenv("AUTODEV_STATE_DB", raising=False)
    from autodev.supervisor import _inner_engine_has_pending_work
    assert _inner_engine_has_pending_work() is True


def test_pending_work_returns_false_when_db_missing(monkeypatch, tmp_path):
    """A non-existent DB legitimately means no pending work — and we
    return False without crashing or logging an error."""
    monkeypatch.setenv("STATE_DIR", str(tmp_path / "nonexistent"))
    monkeypatch.delenv("AUTODEV_STATE_DB", raising=False)
    from autodev.supervisor import _inner_engine_has_pending_work
    assert _inner_engine_has_pending_work() is False


def test_pending_work_returns_false_when_no_rows(monkeypatch, tmp_path):
    """DB exists but has no non-terminal tasks → False."""
    db_path = tmp_path / "orchestrator.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute("CREATE TABLE tasks ("
                  "issue_id INTEGER PRIMARY KEY, repo TEXT, status TEXT)")
        c.execute("INSERT INTO tasks VALUES (1, 'x', 'human_review')")
        c.execute("INSERT INTO tasks VALUES (2, 'x', 'failed')")
    monkeypatch.setenv("STATE_DIR", str(tmp_path))
    monkeypatch.delenv("AUTODEV_STATE_DB", raising=False)
    from autodev.supervisor import _inner_engine_has_pending_work
    assert _inner_engine_has_pending_work() is False


def test_pending_work_autodev_state_db_overrides_state_dir(monkeypatch, tmp_path):
    """AUTODEV_STATE_DB is highest precedence — useful for tests."""
    db_path = tmp_path / "custom.db"
    with sqlite3.connect(str(db_path)) as c:
        c.execute("CREATE TABLE tasks ("
                  "issue_id INTEGER PRIMARY KEY, repo TEXT, status TEXT)")
        c.execute("INSERT INTO tasks VALUES (1, 'x', 'coding')")
    monkeypatch.setenv("AUTODEV_STATE_DB", str(db_path))
    monkeypatch.setenv("STATE_DIR", "/nonexistent/no-way")
    from autodev.supervisor import _inner_engine_has_pending_work, _resolve_state_db_path
    assert _resolve_state_db_path() == db_path
    assert _inner_engine_has_pending_work() is True


def test_resolve_state_db_path_falls_back_to_project_local(monkeypatch):
    """Without any env vars, fall back to project-local state/orchestrator.db,
    NOT to /state/orchestrator.db (the V3 macOS read-only crash path)."""
    monkeypatch.delenv("STATE_DIR", raising=False)
    monkeypatch.delenv("AUTODEV_STATE_DB", raising=False)
    from autodev.supervisor import _resolve_state_db_path
    p = _resolve_state_db_path()
    assert str(p) != "/state/orchestrator.db"
    assert p.name == "orchestrator.db"
    assert "state" in str(p)
