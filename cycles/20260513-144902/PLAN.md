# Cycle 20260513-144902 PLAN — Cycle 37 (Track H1: health.py)

## Target dimension

cross-cuts (S + E) per BACKLOG; primarily S (closes a documented
launchd stop-condition gap). Doesn't move a rubric dim — S is at
L7 max; this is honest-evidence work like Cycle 36. Streak bump
only (17→18).

## Specific gap being closed

`scripts/autodev_continuous_cycle.sh` line ~80 reads
`reports/health.json` and skips dispatch when score < 50. Today
NOTHING writes that file — health is implicitly assumed to be
100. The launchd-driven path's health stop-condition is
non-functional.

`AUTODEV_L7_MASTER_PROMPT.md` §10 specifies the schema in detail
(9 inputs, 0-100 score). This cycle implements a real but minimal
emitter that honors the schema for the signals that can be
honestly measured today (test_status, recent_failure_rate,
stuck_issue_count, large_diff_signs, untracked_file_risk) and
NULLs / defaults the ones that need external infra (Guardian
pauses, cost budget, flaky test signs, lint).

## Change being made

1. **`orchestrator/health.py`** (new, ~150 lines):
   - `HealthSignals` dataclass: each of the 9 signals from §10
     with explicit types and a `score_contribution()` method
     per signal.
   - `compute_signals(repo_root: Path) -> HealthSignals` —
     gather measurable signals from disk:
     - `test_status`: run `pytest -q --collect-only` and check
       exit (no FAIL/error collection); if any pytest exit != 0
       on collection, status = FAIL; else status = PASS.
       (Lightweight — collection-only, not full run.)
     - `recent_failure_rate`: read last N=10
       `reports/cycle-history.jsonl` entries; count FAIL_AS_DATA
       and TIMEOUT vs total.
     - `stuck_issue_count`: scan `tasks/current.md` and
       `tasks/blockers.md` for entries older than 6h (mtime).
     - `large_diff_signs`: `git log --numstat --since=24h` and
       count commits where additions+deletions > 500.
     - `untracked_file_risk`: `git status --porcelain` —
       presence of files matching `.env`, `*.key`, `*.pem`,
       `secrets/*` is "suspicious"; otherwise "clean".
     - `guardian_pauses_last_24h`: count instances of
       `state/PAUSED` in `reports/session-log.md` (heuristic).
     - `flaky_test_signs`: NO_DATA (we don't track flake yet).
     - `lint_typecheck`: NO_DATA.
     - `cost_budget_remaining`: read
       `reports/codex-spend.jsonl` total vs HUMAN_CONFIG cap;
       default to > 50% if absent.
   - `compute_score(signals) -> int` — sum contributions per §10
     table. NO_DATA signals contribute their FULL allocation
     (don't penalize for missing infra).
   - `write_reports(score, signals, repo_root)` — emit:
     - `reports/health.json` (machine)
     - `reports/health.md` (human-readable summary table)
     - `reports/health.history.jsonl` (append one line per call)
   - `main()` CLI entry: `python3 -m orchestrator.health`
     or `python3 orchestrator/health.py` — compute + write,
     print score to stdout, exit 0 (so doctor's call doesn't fail).

2. **`tests/test_health.py`** (new):
   - `compute_signals` on a tmp repo gives PASS test status
   - `compute_score(all_max_signals)` returns 100
   - `compute_score(all_min_signals)` returns 0 or near 0
   - NO_DATA signals don't penalize the score
   - `recent_failure_rate` correctly categorizes from
     cycle-history.jsonl entries
   - `untracked_file_risk`: clean tmp dir → "clean"; tmp dir
     with `.env` → "suspicious"
   - `write_reports` writes all 3 files at expected paths
   - `write_reports` appends (not overwrites) the history file
   - The module's CLI smoke: `python3 orchestrator/health.py`
     produces a JSON file with a numeric "score" key
   - Threshold semantics: score 100 → "green"; 70 → "usable";
     50 → "degraded"; 30 → "red"

3. **`scripts/autodev_health.sh`** (new, executable):
   Thin shell wrapper:
   ```bash
   #!/usr/bin/env bash
   exec python3 "$(dirname "$0")/../orchestrator/health.py" "$@"
   ```
   Per §10: "scripts/autodev_health.sh is the CLI entrypoint.
   Doctor should call it as part of pre-flight."

## Acceptance criteria

- [x] `orchestrator/health.py` exists, importable, has `main()`
- [x] `scripts/autodev_health.sh` exists, executable, runs
- [x] `tests/test_health.py` ≥ 10 tests, all green
- [x] `pytest tests/ -q` green
- [x] After calling `python3 orchestrator/health.py`,
      `reports/health.json` exists with a numeric `score` and
      schema matching §10
- [x] The launchd wake script's "score < 50 → skip" check now
      operates on real data
- [x] `compute_level --check` green (after propose-first)
- [x] `autodev_doctor.sh`: 13/0/2 (unchanged — doctor doesn't
      yet call health, that's deferred to a future cycle to
      avoid bloating this one)

## Files to touch (closed set)

- `orchestrator/health.py` (new)
- `scripts/autodev_health.sh` (new, executable)
- `tests/test_health.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark H1 done; surface H2 as next-cycle candidate)
- `STATE.md` (rewrite)
- `cycles/20260513-144902/PLAN.md` (this)
- `cycles/20260513-144902/REPORT.md`
- `cycles/20260513-144902/RESULT.md`
- `cycles/20260513-144902/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (17→18)
- `reports/cycle-history.jsonl` (append)
- `reports/health.json` (new — first real emit)
- `reports/health.md` (new — first real emit)
- `reports/health.history.jsonl` (new — first line)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.
- `scripts/autodev_continuous_cycle.sh` — the wake script
  ALREADY reads `reports/health.json`; we don't need to
  change it. Decoupling is a feature.

## Rollback plan

`git reset --hard autoevo/pre-20260513-144902`. New module + tests
+ a shell wrapper. Low risk.

## Risk score

low. The health emitter reads disk state only — no network,
no subprocess beyond `pytest --collect-only` (which is safe and
fast) and `git status`/`git log` (read-only). The wake script's
score < 50 check was always there; this cycle just makes the
input data real.

## FAILURES.md pre-flight result

Keywords: health, score, signal, test, lint, failure, stuck,
guardian, pause, flaky, diff, untracked, cost, budget, doctor.

- **FAIL-0003** matched on `guardian`. **Cited and
  disambiguated**: FAIL-0003 is about Guardian false-paused on
  phantom subscription cost (read DB directly, not metrics.json);
  fixed via `orchestrator/billable.py:to_billable_cost`. This
  cycle's health emitter READS the count of Guardian pauses
  from `reports/session-log.md` as one of 9 input signals; it
  does NOT modify billable code, Guardian logic, or the DB
  insert path. Different system, different layer.
- **FAIL-0009** matched on `doctor`. **Cited and disambiguated**:
  FAIL-0009 was the session-log side-effect (Cycle 33 fixed via
  AUTODEV_AUDIT_LOG_SUPPRESS env-var gate). This cycle does NOT
  modify the doctor's import-time self-test path. It defers
  wiring health into the doctor to a future cycle (kept out of
  the closed set deliberately to avoid coupling this cycle to
  doctor behavior).
- No other FAILURES.md matches.

## Open questions / blockers

None.
