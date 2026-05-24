# ADR-0004: Explicit STATE_DIR resolution; never fall back to /state

## Context

V3 E2E test (2026-05-11): `autodev/supervisor.py:_inner_engine_has_pending_work`
crashed during pending-work detection on macOS with:
```
OSError: [Errno 30] Read-only file system: '/state'
```

Root cause: pre-V4 code assumed `STATE_DIR` defaulted to `/state` (the
Docker container path). On macOS host, `/state` is read-only (macOS's root
filesystem is sealed). The fallback was wrong for any non-container run.

Worse: the function silently returned `False` on any other exception class,
so the supervisor mis-detected "no pending work" and skipped the inner engine
even when work existed.

## Decision

New helper `_resolve_state_db_path()` with explicit env-var precedence:

```python
def _resolve_state_db_path() -> Path:
    # 1. Highest priority: explicit DB path
    if v := os.environ.get("AUTODEV_STATE_DB"):
        return Path(v)
    # 2. Next: explicit state dir
    if v := os.environ.get("STATE_DIR"):
        return Path(v) / "orchestrator.db"
    # 3. Project-local fallback (NEVER /state)
    return Path(__file__).resolve().parent.parent / "state" / "orchestrator.db"
```

`_inner_engine_has_pending_work` uses this helper, opens the SQLite DB with
explicit error handling, and emits a clear `logging.getLogger("supervisor.pending_work").warning(...)`
diagnostic on any DB error. Silent `False` is replaced with an exception
log + `False` return (so callers can still continue, but the operator sees
the error).

## Consequences

Good:
- macOS host runs no longer crash on the read-only `/state` fallback.
- Test isolation: tests set `AUTODEV_STATE_DB` to a per-test temp path
  via a fixture.
- Operators on non-default state-dir setups (Docker-out-of-Docker, CI
  caches, etc.) can override without code changes.
- DB errors are visible instead of silent.

Bad:
- The helper has 3 precedence rules to remember. Mitigated by the env-var
  names being self-documenting and the helper's own tests.
- The project-local fallback assumes a specific layout (`autodev/../state/`).
  If a future refactor moves `autodev/`, the fallback must be updated.
  Mitigated: the path is `Path(__file__).resolve().parent.parent / "state"`,
  which is layout-aware via `__file__`.

## Alternatives Rejected

- **Make the existing /state path lazy + catch the OSError.** Rejected:
  patches symptom not cause. Other code paths still bake `/state` in.
- **Use `tempfile.gettempdir()` as the fallback.** Rejected: temp dir is
  cleaned aggressively by macOS; we'd lose state between cycles.
- **Require the operator to ALWAYS set STATE_DIR.** Rejected: hostile to
  new contributors who just want to `pytest`. Project-local fallback is
  the right default.

## Linked regression test

- `tests/test_v4_hardening.py::test_resolve_state_db_path_uses_autodev_state_db`
- `tests/test_v4_hardening.py::test_resolve_state_db_path_uses_state_dir`
- `tests/test_v4_hardening.py::test_resolve_state_db_path_falls_back_to_project_local`
- `tests/test_v4_hardening.py::test_pending_work_honors_state_dir_env`
- `tests/test_v4_hardening.py::test_pending_work_autodev_state_db_overrides_state_dir`
- `tests/test_v4_hardening.py::test_pending_work_returns_false_when_db_missing`

## Linked cycle

Original implementation: commit `110e7bd` (V4 Track 4, pre-L7).
Ratified into L7 memory: Cycle `20260512-042701` (Bootstrap).
