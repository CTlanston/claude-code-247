# Cycle 20260512-044425 PLAN — Track M2.5 (FAILURES expansion)

## Target dimension
M (Memory)

## Specific gap being closed
M-dim L5 requires BOTH (a) `scripts/preflight_failures.py` (done in Cycle
20260512-043811) AND (b) `FAILURES.md` with >= 10 entries. Today
FAILURES.md has 4 entries. This cycle adds 6+ historical-but-real failure
entries with full provenance (commit SHA, report file path, or test name),
unlocking M-dim L5.

## Change being made

1. Append 6+ new entries to `FAILURES.md`, each with the §5 schema
   (id, symptom, root cause, failed fix attempts, working fix, regression
   test, keywords, linked ADR if applicable). Sources of real failures:
   - PyGithub `PaginatedList` IndexError on empty workflow runs (V4 era,
     committed in `9df48f6`)
   - Bare-remote-missing → silent push loss (V4 era, same commit)
   - record_run idempotency missing → phantom-cost double-write
     (tasks/backlog.md TASK-007, GitHub issue #6 on test repo)
   - `.dockerignore` missing → image bloat (TASK-004)
   - Hard-coded per-role token budgets (TASK-005)
   - cleanup-worktree never called at merged transition (TASK-006)
   - reports/session-log.md doctor-import side effect dirties working
     tree each cycle (observed in cycles 0 and 1)
2. Add `tests/test_failures_integrity.py` with regression tests that
   verify FAILURES.md has >= 10 entries AND each entry has the schema's
   required fields.

Two commits on this branch: `test:` (failing — schema validator) then
`docs:` (FAILURES entries — turns the schema validator green via the new
documented entries).

## Acceptance criteria
- [ ] `FAILURES.md` has >= 10 `## FAIL-NNNN` entries
- [ ] Every entry has fields: Date, Symptom, Root cause, Working fix,
      Regression test, Keywords
- [ ] `tests/test_failures_integrity.py` has >= 4 tests covering:
      entry-count threshold, schema completeness on every entry,
      keyword-format check, ID-monotonicity (no duplicates / no gaps)
- [ ] `pytest -q` green; no existing test regresses
- [ ] `scripts/compute_level.py` reports `M = 5` after this cycle
- [ ] `scripts/compute_level.py --check` does NOT regress any other dim
- [ ] `./scripts/autodev_doctor.sh` exits 0 (warns allowed)
- [ ] `scripts/preflight_failures.py --plan <this PLAN> --failures FAILURES.md`
      still works and returns reasonable matches (sanity)

## Files to touch (closed set)
- `FAILURES.md` (append 6+ entries)
- `tests/test_failures_integrity.py` (new)
- `cycles/20260512-044425/PLAN.md` (this)
- `cycles/20260512-044425/RESULT.md` (new)
- `cycles/20260512-044425/REPORT.md` (new)
- `cycles/20260512-044425/STATE.before.md` (snapshot)
- `cycles/20260512-044425/verify-output.txt` (new)
- `BACKLOG.md` (mark M2.5 DONE; next P0 = E2 or T2-billable)
- `STATE.md` (rewrite)
- `CHANGELOG.md` (append cycle line, no 🎯 since M-dim move doesn't
  affect overall L=3)
- `LEVEL.md` (regenerate)

## Files forbidden to touch
- `.env*`, `secrets/**`, `*.key`, `*.pem`, `id_rsa*`
- `LEVEL.md` by hand
- `orchestrator/**`, `autodev/**`, `runner/**` (no production code this
  cycle — pure documentation + a tiny test)
- Existing ADRs (append-only)
- Existing FAILURES.md entries (append-only)
- Other tests (only the new test_failures_integrity.py)

## Rollback plan
`git reset --hard autoevo/pre-20260512-044425`

## Risk score
low — documentation + a small schema-validator test. Worst case: schema
validator catches a malformed entry I wrote; fix it inline before
commit, or roll back.

## FAILURES.md pre-flight result

`scripts/preflight_failures.py --plan <this PLAN.md> --failures FAILURES.md`
(run after writing this) flagged:

- **FAIL-0003** (Guardian false-pause on phantom subscription cost) —
  matched on keywords `phantom_cost` + `record_run`. Cited here.

  This cycle is NOT repeating FAIL-0003. FAIL-0003 was about Guardian
  reading raw `runs.cost_usd` under subscription mode and false-pausing;
  the working fix was V4 commit 110e7bd's `to_billable_cost` zero-at-INSERT.
  This cycle DOCUMENTS a *sibling* failure (idempotency missing on
  `record_run` → phantom-cost double-write when an early-exited role
  retries; tracked as task-007 in tasks/backlog.md and GitHub issue #6
  on the test repo). The new FAIL-NNNN entry will cite FAIL-0003 as
  related context.

  No code change is being made here — this cycle is purely additive
  documentation. The fix for the sibling failure can come in a later
  cycle once we've reproduced it on the host.

## Open questions / blockers
None.
