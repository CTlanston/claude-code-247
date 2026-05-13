# Cycle 20260513-045716 PLAN — Track T7 (golden-diff fixtures)

## Target dimension
T (Test oracle)

## Specific gap being closed

`compute_level.py:test_dim` L7 check:
```python
golden_dir = repo_root / TEST_MARKERS["golden_diff"]["fixture_paths"][0]
if level >= 6 and golden_dir.exists():
    level = 7
```

So the minimum-acceptance bar is just "tests/golden/ exists". Per the
AUTODEV_L7_CONTINUOUS_RUN.md Phase A item 2 (Cycle 23), the actual
quality bar is:
- `tests/golden/` directory with captured stdout/stderr/state-mutation
  patterns for known-good outputs
- `tests/test_golden_diff.py` with character-level diff vs fixtures
- On mismatch: write diff to `cycles/<id>/golden-diff.md`, fail the test
  (do NOT auto-update)
- `scripts/update_goldens.sh` — the only way to refresh fixtures, with
  operator confirmation prompt

This cycle lifts T 6 → L7 (max).

## Change being made

1. **`tests/golden/`** (new dir): contains canonical reference outputs
   for selected pure-function calls. Initial fixtures:
   - `tests/golden/compute_level_baseline.txt` — output of
     `python3 scripts/compute_level.py --verbose` against the current
     real repo state (M=7 S=7 R=7 C=4 T=6 E=6 Overall=4 AT THIS CYCLE
     START). Note: this captures the PRE-CYCLE-23 state; after cycle 23
     T moves to L7 and the golden will be stale (that's a feature — the
     next regen via `update_goldens.sh` should be a documented operator
     action).
   - `tests/golden/billable_to_dict_subscription.txt` — fixed-input
     output of `to_billable_cost` with a known input vector.
   - `tests/golden/preflight_sample_issue.txt` — fixed-input output of
     `preflight_issue(title, body, root)` for a benign sample.
   - `tests/golden/n_of_3_unanimous_approve.txt` — fixed-input output
     of `n_of_3('approve','approve','approve').to_dict()` as JSON.
   The first one is operator-refresh-on-purpose; the next 3 are stable.

2. **`tests/test_golden_diff.py`** (new, ≥ 4 tests):
   - One test per stable fixture, comparing the function's current
     output against the captured golden via `difflib.unified_diff`
   - On mismatch: writes diff to `cycles/<id>/golden-diff.md` (where
     `<id>` is the current CYCLE_ID env var, or a temp fallback), then
     asserts equality with a helpful error message
   - Stable fixtures pass; the compute_level fixture is marked
     `@pytest.mark.skipif(not stable)` because its content depends on
     LEVEL.md which mutates every cycle. The skip is the right
     long-term answer; manually-curated `update_goldens.sh` is the
     refresh path.

3. **`scripts/update_goldens.sh`** (new, executable):
   - Prompts the operator: "About to refresh tests/golden/<fixture>.
     Continue? [y/N]"
   - Reads stdin; only proceeds on literal `y` or `yes`
   - Regenerates fixtures by re-running each capture, writes to
     `tests/golden/`
   - Exit 0 on success, 1 on operator-decline, 2 on capture failure
   - Tests cover: decline path, accept path, fixture regeneration

4. **`tests/test_update_goldens.py`** (new, ≥ 3 tests):
   - declining → exits 1, no changes
   - accepting (`echo y | ...`) → exits 0, fixtures present
   - exists + executable

## Acceptance criteria
- [ ] `tests/golden/` exists with ≥ 4 fixtures
- [ ] `tests/test_golden_diff.py` has ≥ 4 tests, all green
- [ ] `tests/test_update_goldens.py` has ≥ 3 tests, all green
- [ ] `scripts/update_goldens.sh` exists + executable
- [ ] `pytest -q` full suite green
- [ ] `compute_level.py` reports `T = 7` (max)
- [ ] `compute_level --check` exits 0
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL updated

## Files to touch (closed set)
- `tests/golden/*.txt` (new fixtures)
- `tests/test_golden_diff.py` (new)
- `tests/test_update_goldens.py` (new)
- `scripts/update_goldens.sh` (new, executable)
- `cycles/20260513-045716/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Files forbidden to touch
- secrets, LEVEL by hand
- existing production code
- existing tests (only NEW test files this cycle)

## Rollback plan
`git reset --hard autoevo/pre-20260513-045716`

## Risk score
low — additive fixture files + new tests + new helper script. No
production flow changes.

## FAILURES.md pre-flight result
Will run after writing.
