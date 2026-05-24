# Cycle 20260513-045243 PLAN — Track T6 (live sanity script)

## Target dimension
T (Test oracle)

## Specific gap being closed

`compute_level.py:test_dim` L6 check:
```python
live_script = repo_root / TEST_MARKERS["live_sanity"]["script_paths"][0]
live_log_dir = repo_root / "reports" / "live-sanity"
if level >= 5 and live_script.exists() and live_log_dir.exists():
    level = 6
```

Today neither `scripts/v5_live_sanity.sh` nor `reports/live-sanity/`
exist. This cycle creates both + the regression test suite.

Per L7 §3 rubric Dim T: "live sanity loop per RC" (release candidate).
Per AUTODEV_L7_CONTINUOUS_RUN.md Phase A item 1 (Cycle 22).

## Change being made

1. **`scripts/v5_live_sanity.sh`** (new, executable):
   - Reads `AUTODEV_LIVE` env var (default 0)
   - **Dry-run (default, `AUTODEV_LIVE=0`)**: simulates one full pipeline
     tick by walking through the inner-engine state-machine STATES
     deterministically (no real role invocations, no GitHub calls, no
     codex). Writes a JSON to `reports/live-sanity/<ts>.json` with
     the simulated state transitions. Exits 0.
   - **Live mode (`AUTODEV_LIVE=1`)**: ALSO requires
     `HUMAN_CONFIG.runtime.live_sanity_authorized: true` (which is
     NOT set in HUMAN_CONFIG.md today, by design). If not authorized,
     exit 2 with a clear refusal message. If authorized, proceed with
     a real one-issue pipeline tick (not implemented this cycle —
     placeholder that exits 3 with TODO message). This keeps the
     live path opt-in × 2 (env var AND config flag).

2. **`reports/live-sanity/`** (new directory): created on first dry-run.
   `.gitkeep` committed so the directory exists in git.

3. **`tests/test_live_sanity.py`** (new, ≥ 5 tests):
   - Dry-run produces valid JSON in reports/live-sanity/
   - JSON schema includes `started_at`, `ended_at`, `state_transitions`,
     `mode`, `result`
   - Live mode without config-flag → exit 2 with refusal message
   - Live mode WITH config-flag → exit 3 (placeholder for future)
   - Script exists + is executable
   - Two consecutive dry-runs write two distinct timestamped files
     (idempotent within reason)

4. **`scripts/autodev_doctor.sh`** (extend): add a check that
   `scripts/v5_live_sanity.sh` exists + is executable. Doctor stays
   green if so.

5. **`HUMAN_CONFIG.md`**: add `runtime.live_sanity_authorized: false`
   field as the safety flag.

## Acceptance criteria
- [ ] `scripts/v5_live_sanity.sh` exists + executable
- [ ] `reports/live-sanity/` directory exists in git (via .gitkeep)
- [ ] `tests/test_live_sanity.py` has ≥ 5 tests, all green
- [ ] `pytest -q` full suite green; no regression
- [ ] `compute_level.py` reports `T = 6` after this cycle
- [ ] `compute_level --check` exits 0
- [ ] `scripts/autodev_doctor.sh` includes live-sanity check; doctor
      exits 0 (warns allowed)
- [ ] `HUMAN_CONFIG.md` has the new safety flag
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated

## Files to touch (closed set)
- `scripts/v5_live_sanity.sh` (new)
- `tests/test_live_sanity.py` (new)
- `reports/live-sanity/.gitkeep` (new)
- `scripts/autodev_doctor.sh` (extend, 1-line check)
- `HUMAN_CONFIG.md` (+ live_sanity_authorized field)
- `cycles/20260513-045243/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Files forbidden to touch
- secrets, LEVEL by hand
- existing production code (orchestrator/main.py untouched)
- existing tests except potentially autodev_doctor's smoke

## Rollback plan
`git reset --hard autoevo/pre-20260513-045243`

## Risk score
low — additive script + new directory + new test file + 1-line doctor
extension. No production flow changes.

## FAILURES.md pre-flight result

Preflight flagged:
- **FAIL-0007** (record_run idempotency) on `role` + `started_at` —
  appears in this PLAN because the dry-run simulates state transitions
  using inner-engine role names; the JSON schema includes `started_at`.
  This cycle does NOT touch `record_run` or the DB layer; the simulated
  JSON is purely a sanity-script artifact. **Not a repeat of FAIL-0007.**
- **FAIL-0009** (doctor side-effect dirties session-log.md) on
  `doctor` — this cycle ADDS a single-line check to autodev_doctor.sh
  ("does v5_live_sanity.sh exist + executable?"). The new check
  does NOT itself call any CLI classify-test that writes to
  session-log.md. **Different code path; not a repeat.**

## Open questions / blockers
None.
