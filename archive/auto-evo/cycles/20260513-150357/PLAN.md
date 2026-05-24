# Cycle 20260513-150357 PLAN — Cycle 40 (wake refreshes health)

## Target dimension

S (Safety gates). Closes the deferred work from Cycle 39: now
that the health artifacts are gitignored, the wake script can
safely refresh them on every dispatch decision. No level move.
Streak bump only (20→21).

## Specific gap being closed

After Cycles 37-39, all the pieces are in place:
- Cycle 37 emits `reports/health.json`
- Cycle 38 has the doctor read it (read-only)
- Cycle 39 untracked + gitignored the 3 artifacts

But the wake script `scripts/autodev_continuous_cycle.sh` line 62
reads `reports/health.json` without first refreshing it.
The file becomes stale if nothing else calls `autodev_health.sh`.
On a real launchd run, the file would only be as fresh as the
last manual refresh.

This cycle wires the refresh INTO the wake script, with a
controllable env-var knob in case the operator wants to skip the
refresh for debugging.

## Change being made

1. **`scripts/autodev_continuous_cycle.sh`** (~5-line insertion
   before line 62):
   ```bash
   # --- Refresh health score before reading ---
   # Cycle 40: invoke autodev_health.sh so reports/health.json
   # reflects current disk state. The artifacts are gitignored
   # (Cycle 39) so this does NOT dirty the tracked tree. Operator
   # can skip via AUTODEV_SKIP_HEALTH_REFRESH=1 (debugging).
   if [[ -z "${AUTODEV_SKIP_HEALTH_REFRESH:-}" ]]; then
     bash "$(dirname "$0")/autodev_health.sh" >/dev/null 2>&1 || true
   fi
   ```
   The `|| true` ensures a failure of autodev_health.sh doesn't
   abort the wake — fail-open. The wake script's existing
   `if [[ -f reports/health.json ]]` guard handles the file-
   missing case.

2. **`tests/test_wake_refreshes_health.py`** (new):
   - Wake script source contains the `autodev_health.sh`
     invocation and the env-var guard.
   - When invoked with a stub `autodev_health.sh` that emits a
     score=42 health.json, the wake script reads score=42 and
     skips dispatch (< 50).
   - When invoked with `AUTODEV_SKIP_HEALTH_REFRESH=1`, the
     wake skips the refresh (stub `autodev_health.sh` is NOT
     called).
   - When `autodev_health.sh` is missing or fails, the wake
     script still proceeds (fail-open via `|| true`).
   - Working-tree-clean invariant: after the wake invokes the
     real `autodev_health.sh`, `git status --porcelain` adds
     no NEW health-file entries.

## Acceptance criteria

- [x] Wake script source contains the refresh block
- [x] Test suite shows the refresh actually runs (stub captures
      invocation)
- [x] `AUTODEV_SKIP_HEALTH_REFRESH=1` bypasses the refresh
- [x] Missing autodev_health.sh → wake proceeds (fail-open)
- [x] Working tree stays clean after wake invokes the real
      health emitter (FAIL-0009 invariant preserved)
- [x] `pytest tests/ -q` green
- [x] `compute_level --check` green (after propose-first)
- [x] `autodev_doctor.sh`: 14/0/2 (unchanged)

## Files to touch (closed set)

- `scripts/autodev_continuous_cycle.sh` (~7-line insertion)
- `tests/test_wake_refreshes_health.py` (new)
- `CHANGELOG.md` (one line)
- `STATE.md` (rewrite)
- `cycles/20260513-150357/PLAN.md` (this)
- `cycles/20260513-150357/REPORT.md`
- `cycles/20260513-150357/RESULT.md`
- `cycles/20260513-150357/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (20→21)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.
- Existing tests (the existing 15 wake-script unit tests + 7
  smoke tests should pass unchanged — the new block is
  gated on the env-var so tests that set AUTODEV_SKIP_HEALTH_REFRESH=1
  or whose tmp_path doesn't have autodev_health.sh see no
  behavior change).

## Rollback plan

`git reset --hard autoevo/pre-20260513-150357`. The change is
small and isolated.

## Risk score

low. ~7 lines of additive shell + fail-open semantics.
The existing wake-script tests use tmp_path repos that don't
contain `autodev_health.sh`, so the `|| true` keeps them
passing.

## FAILURES.md pre-flight result

Keywords: wake, health, refresh, dispatch.

- No FAILURES.md matches directly. Cycle 33's FAIL-0009
  discipline is implicitly observed (the refresh writes to
  gitignored paths only).

## Open questions / blockers

None.
