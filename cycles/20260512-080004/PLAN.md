# Cycle 20260512-080004 PLAN — Track T5 (homegrown mutator on billable.py)

## Target dimension
T (Test oracle)

## Specific gap being closed

`compute_level.py:test_dim` L5 requires `reports/mutmut-kill-rate.txt`
with a float ≥ 0.80. Cycle 14 attempted this via `mutmut` 3.3.1 and
hit FAIL-0011 (mutant-tree copy breaks cross-module imports). FAIL-0011
listed four candidate workarounds; this cycle takes **option 3** —
a homegrown small-scope mutation tester for `orchestrator/billable.py`
(94 lines, 3 functions, well-tested by V4 + properties).

## Change being made

1. **`scripts/mutate_billable.py`** (new):
   - Parse `orchestrator/billable.py` with `ast`
   - Collect mutation candidates by walking the AST:
     * **comparison flip**: `==↔!=`, `<↔>=`, `>↔<=`, `<=↔>`, `>=↔<`
     * **boolean flip**: `True↔False`
     * **numeric off-by-one**: integer constants (skip 0) → ±1
     * **binop swap**: `+↔-`, `*↔/` (skip when args are strings)
     * **return-none**: `return <expr>` → `return None` (skip when expr already None)
     * **unaryop drop**: `not x` → `x`
   - Skip mutations inside docstrings + module-level string constants
   - For each candidate:
     a. `ast.unparse(mutated_tree)` → mutated source
     b. Backup `orchestrator/billable.py` to bytes in memory
     c. Write mutant to disk
     d. Run `python3 -m pytest -q --no-cov -x tests/test_v4_hardening.py`
     e. `restore from backup` (try/finally, **always restored**)
     f. Record: killed (test failed) or survived
   - Compute kill rate = killed / total
   - Write `reports/mutmut-kill-rate.txt` (one float on first line)
   - Write `reports/mutation-report.md` (human-readable: per-mutant
     location + verdict)

2. **`tests/test_homegrown_mutator.py`** (new, ≥ 10 tests):
   - Each mutation operator produces correct AST transformation
   - `collect_mutations()` enumerates candidates correctly
   - Docstring constants are skipped
   - Kill-rate arithmetic is correct
   - End-to-end on a small known-good module
   - `apply_mutation` is pure (returns new tree, doesn't mutate input)
   - **Critical safety test**: even if mutation N raises, billable.py
     is always restored (try/finally invariant)

3. **Live run** against `orchestrator/billable.py`:
   - Acceptance criterion: kill rate ≥ 0.80
   - If lower, document partial result + analyze surviving mutants
     in `reports/mutation-report.md`; cycle still PASSES infrastructure-
     wise, but T-dim stays L4 with informative evidence.

## Acceptance criteria
- [ ] `scripts/mutate_billable.py` exists + executable
- [ ] `tests/test_homegrown_mutator.py` has ≥ 10 tests, all green
- [ ] Running `python3 scripts/mutate_billable.py` against
      `orchestrator/billable.py` writes `reports/mutmut-kill-rate.txt`
      with a parseable float
- [ ] Kill rate ≥ 0.80 — lifts T 4 → 5
- [ ] `pytest -q` full suite green; no regression
- [ ] `scripts/compute_level.py --check` exits 0
- [ ] `orchestrator/billable.py` byte-identical before vs after the
      mutation run (try/finally restore verified)
- [ ] CHANGELOG, STATE, BACKLOG, LEVEL all updated

## Files to touch (closed set)
- `scripts/mutate_billable.py` (new)
- `tests/test_homegrown_mutator.py` (new)
- `reports/mutmut-kill-rate.txt` (new, generated)
- `reports/mutation-report.md` (new, generated)
- `cycles/20260512-080004/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Files forbidden to touch
- `orchestrator/billable.py` (the SUT — must remain byte-identical
  before vs after; mutation run is transient)
- `tests/test_v4_hardening.py`, `tests/test_billable_properties.py`
  (the kill set — must not be modified)
- secrets, LEVEL by hand
- Other production code

## Rollback plan
`git reset --hard autoevo/pre-20260512-080004`. The mutator script uses
try/finally to guarantee billable.py restoration even on KeyboardInterrupt;
worst case scenario is the script crashing mid-mutation — in which case
the backup-restore code path handles it.

## Risk score
medium — temporarily writes to a production file (`orchestrator/billable.py`)
during mutation runs. Mitigated by:
1. In-memory byte backup (NOT a separate file — atomic via Python)
2. try/finally around every mutation run
3. Final hash check: assert byte-identical before vs after
4. Tests run synchronously (no race window)
5. The fault-tolerance test in the test file specifically verifies that
   exceptions during a mutation don't leak corrupted state

## FAILURES.md pre-flight
Will run after writing this section.

## Open questions / blockers
- Hypothesis property tests might be slow per mutant — only include
  deterministic test_v4_hardening.py in the kill set initially
- `ast.unparse` is Python 3.9+ ✓ (verified)
- billable.py has 9 Return nodes, 3 BinOp, 2 Compare, 1 UnaryOp, plus
  ~12 useful Constants (after filtering docstrings) → ~25 mutation
  candidates expected. 80% kill = 20 killed, 5 surviving acceptable.
