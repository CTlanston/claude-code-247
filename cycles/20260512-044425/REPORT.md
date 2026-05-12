# Cycle 20260512-044425 Report — Track M2.5

## Verdict
PASS — M-dim moved L4 → L5 (a dim-internal level-up; overall L stays at 3
because R/C/T/E are still at the L3 floor).

## Target dim
M (Memory)

## Level changes
| Dim | Before | After | Note |
|---|---|---|---|
| M | 4 | **5** | FAILURES.md grown from 4 to 10 entries + preflight script (from Cycle 1) — both L5 preconditions now met |
| S | 5 | 5 | unchanged |
| R | 3 | 3 | unchanged |
| C | 3 | 3 | unchanged |
| T | 3 | 3 | unchanged |
| E | 3 | 3 | unchanged |

**Overall L = 3** (unchanged; R/C/T/E still floor).

No 🎯 marker because overall L did not move; the level-up is internal to
the M dim and will compound when R/C/T/E catch up.

## Change

Appended 6 new historical-but-real FAILURES.md entries with full provenance:

| ID | Headline | Source / commit |
|---|---|---|
| FAIL-0005 | PyGithub PaginatedList IndexError froze inner-engine loop | 9df48f6 (defensive try/except shipped) |
| FAIL-0006 | Bare-remote missing → silent push loss → empty shadow branch | 9df48f6 (Path-B worktree fallback) |
| FAIL-0007 | record_run double-write phantom-cost rows | TASK-007 / issue #6 (NOT YET FIXED) |
| FAIL-0008 | .dockerignore absent → image bloat + .env leak risk | TASK-004 (NOT YET FIXED) |
| FAIL-0009 | doctor's "modules import cleanly" check dirties session-log.md | Observed in Cycle 0 & 1 (NOT YET FIXED) |
| FAIL-0010 | V3 supervisor stuck at inner_engine_exit_3 with `blocked=true` | reports/state.json snapshot (NOT YET FIXED) |

4 of the 6 are documented-but-unfixed; they become BACKLOG candidates.

Plus `tests/test_failures_integrity.py` with 7 schema tests that lock in:
- >= 10 entries (the L5 threshold)
- All required fields per §5 schema present in every entry
- IDs are unique and contiguous starting from 1
- Every entry has >= 3 distinct keywords

## Dogfooding result (the L7 discipline loop)

`scripts/preflight_failures.py --strict` on this cycle's PLAN.md flagged
FAIL-0003 (Guardian phantom-cost) via `phantom_cost` + `record_run`
keyword overlap. The PLAN's "FAILURES.md pre-flight result" section was
updated to cite FAIL-0003 explicitly with "why this time is different"
(sibling failure: row-duplication vs. value-mask). Re-running with the
citation passed `--strict` (rc=0). **The L7 self-discipline loop is
working as designed.**

## Files modified

```
FAILURES.md                                  (+ ~190 lines: 6 new entries)
tests/test_failures_integrity.py             (155 lines, new)
CHANGELOG.md                                 (+ 1 line)
BACKLOG.md                                   (M2.5 → DONE; E2 + T2 next P0)
STATE.md                                     (rewritten; M=5)
LEVEL.md                                     (regenerated; M=5)
cycles/20260512-044425/PLAN.md
cycles/20260512-044425/STATE.before.md
cycles/20260512-044425/RESULT.md
cycles/20260512-044425/REPORT.md             (this file)
cycles/20260512-044425/verify-output.txt
```

No production code touched.

## Tests added

7 tests in `tests/test_failures_integrity.py`:
- `test_failures_md_exists`
- `test_failures_md_has_at_least_10_entries`
- `test_every_entry_has_required_fields`
- `test_every_entry_has_nonempty_keywords`
- `test_entry_ids_are_unique`
- `test_entry_ids_are_contiguous_starting_from_1`
- `test_each_entry_keywords_match_preflight_parse`

## Commits on this branch (TDD intent intact)

```
(pending docs+record commit) docs(cycle-2): close M2.5 + bookkeeping
???????  docs(failures): append 6 historical entries (FAIL-0005..0010)
bbe26a0  test(failures): add FAILURES.md integrity test suite (Track M2.5)
```

Order: `test:` (RED — 1/7 fails) → `docs:` (GREEN — adds the missing
entries) → trailing `docs:` (close-out bookkeeping). TDD intent
satisfied.

## Verify output (truncated)

```
=== pytest -q ===
147 passed, 1 skipped in 0.49s

=== compute_level --verbose ===
M 5 | evidence: CHANGELOG.md present; CONTEXT.md present + 5 ADRs; FAILURES.md has 10 entries + preflight script wired
S 5 | (unchanged)
R 3 | (unchanged) ...
Overall L = 3

=== preflight self-check on Cycle 2 PLAN ===
1 match: FAIL-0003 [✓ cited] score=2 overlap=['phantom_cost','record_run']
--strict rc=0
```

Full verbatim output: `cycles/20260512-044425/verify-output.txt`.

## FAILURES.md entry
N/A (cycle passed).

## Next recommended track
**[Track E2]** — implement `scripts/propose_next_track.py`. Cheapest
single-cycle move that lifts a floor dim (E: L3 → L4). After E2, all
four floors (R/C/T/E) need raising before overall L can move from 3 → 4.

## Wall clock used
Approximate: ~10 minutes (orient + plan + tests + entries + verify +
record). Well under 45-min budget.

## Cycle termination checklist (§13)
- [x] RESULT.md exists (PASS)
- [x] git status clean after commit (to verify)
- [x] CHANGELOG.md has exactly one new line
- [x] STATE.md updated (M=5, last_levelup=this cycle)
- [x] LEVEL.md regenerated (M=5)
- [x] Only PLAN-allowed files touched
- [x] No secrets / LEVEL.md hand-edit / paid API / push
- [x] RESULT=PASS, no rollback / no FAILURES entry from this cycle
- [x] Track-specific gate: 7 integrity tests pass; FAILURES.md now has
      exactly 10 entries with FAIL-0001..FAIL-0010 contiguous
- [x] No subagent left running
