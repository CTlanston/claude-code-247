# Cycle 20260512-080004 Report — Track T5 (homegrown mutator)

## Verdict
PASS — T-dim L4 → L5. Homegrown AST-based mutation tester on
`orchestrator/billable.py` achieved **100% kill rate (21/21)** with a
deterministic kill set (V4 hardening tests + new mutation anchors).

This resolves FAIL-0011 (mutmut 3.x cross-module import wall) via
option 3 from the FAIL-0011 workaround list: write our own.

## Level changes
| Dim | Before | After |
|---|---|---|
| M | 7 | 7 (max) |
| S | 7 | 7 (max) |
| R | 5 | 5 |
| C | 4 | 4 (sole remaining floor) |
| T | 4 | **5** |
| E | 6 | 6 |

Overall L = 4 (unchanged; C is sole floor).

## Change

1. **`scripts/mutate_billable.py`** (new, executable, ~270 lines):
   - AST-based mutator targeting `orchestrator/billable.py`
   - 6 mutation operators: comparison flip, boolean flip, numeric
     off-by-one, binop swap, return-None, unaryop drop
   - Per-mutant: in-memory backup → write mutant → run kill set →
     try/finally restore (byte-identity invariant)
   - Built-in **baseline sanity check**: refuses to report kill rate
     if the un-mutated kill set fails (prevents the false-100% bug
     this cycle's own development hit and recovered from)
   - Writes `reports/mutmut-kill-rate.txt` (float) + a per-mutant
     markdown report

2. **`tests/test_homegrown_mutator.py`** (new, 26 tests, all green):
   - Each operator's AST transformation (8 tests)
   - Candidate collection skips docstrings (3 tests)
   - `apply_mutation` is pure (1 test)
   - kill_rate arithmetic (3 tests)
   - SUT byte-identity invariant under exception (2 tests)
   - End-to-end on synthetic module (1 test)
   - CLI smoke (1 test)

3. **`tests/test_billable_mutation_anchors.py`** (new, 7 tests, 1 skipped):
   Surgical deterministic anchors for the V4 survivors:
   - M11: exception path in `to_billable_cost` (TypeError + ValueError)
   - M14: `db_path doesn't exist` early-exit in `load_budget_metrics`
   - M19: 86400-second window boundary
   - M20/M21: SQLite `timeout=5` parameter
   - M18: documented stubborn survivor (1-second shift inside 300-second
     buckets, not deterministically killable) — skipped with explanation

4. **`reports/mutmut-kill-rate.txt`**: `1.0000`
5. **`reports/mutation-report.md`**: per-mutant table

## Files modified
```
scripts/mutate_billable.py                       (new, executable, 296 lines)
tests/test_homegrown_mutator.py                  (new, 26 tests, 290 lines)
tests/test_billable_mutation_anchors.py          (new, 7 anchor tests, 220 lines)
reports/mutmut-kill-rate.txt                     (new, "1.0000")
reports/mutation-report.md                       (new, generated)
cycles/20260512-080004/{PLAN,RESULT,REPORT,STATE.before,verify-output,
                       next-track-proposal}.md/json
CHANGELOG.md, BACKLOG.md, STATE.md, LEVEL.md
```

## Files NOT modified
- `orchestrator/billable.py` (the SUT — verified byte-identical via
  `md5 -q` before vs after mutation run)
- `tests/test_v4_hardening.py` and `tests/test_billable_properties.py`
  (the existing kill set — per PLAN's "files forbidden to touch" rule)

## Implementation gotcha → permanent defense

Initial attempt at deterministic kill rate used `--hypothesis-derandomize`
as a pytest CLI flag. Hypothesis 6.141.1 doesn't expose that flag;
pytest exited with "unrecognized arguments" → non-zero → every mutant
spuriously marked "killed" → false 100% kill rate.

Caught + fixed:
1. `run_kill_set()` now does a baseline test-command run FIRST on
   un-mutated SUT. If it exits non-zero, raises RuntimeError with the
   first 500 chars of pytest output — defends against any future
   kill-set misconfiguration silently inflating the kill rate.
2. Replaced the Hypothesis-derandomize approach with **deterministic
   anchor tests** (`test_billable_mutation_anchors.py`). Result: kill
   rate is now stable across consecutive runs (verified) AND has zero
   Hypothesis dependency for the mutation kill set.

The full property-test suite continues to run in the regular pytest
suite (313 passed); they're just not in the mutation kill set.

## Verify
- pytest: 313 passed, 2 skipped, 0 failed
- compute_level: T=L5 ("Mutation kill rate 100.00%")
- compute_level --check: passed
- doctor: 11/0/2
- byte-identity check: `md5 -q orchestrator/billable.py` matches
  before vs after the mutation run

## What this DOESN'T do (scope clarifications)

- Does NOT mutate other orchestrator/ modules. T-L5 was achieved on
  one module; broader coverage is future T-track work.
- Does NOT mutate the SUT for tests OTHER than V4-hardening + anchors.
  The Hypothesis property tests are excluded specifically because they
  introduce randomness incompatible with deterministic kill-rate
  reporting.
- Does NOT change overall L. C is still the sole L4 floor.

## Next track
Per propose_next_track + user directive: **Track R6** (adversarial
reviewer subagent). Lifts R 5 → 6 in one cycle.

## Wall clock
~25 minutes (under the 45-min budget). The longest single step was
the live mutation runs (~3 min each at 21 mutants × ~5s per pytest
invocation).
