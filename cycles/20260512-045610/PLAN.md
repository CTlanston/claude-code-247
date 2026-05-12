# Cycle 20260512-045610 PLAN — Track T2-property-preflight (2/3)

## Target dim
T (Test oracle)

## Specific gap being closed
T-dim L4 requires property-based tests on ≥ 3 modules. Cycle 4 added 1
(billable). This cycle adds module 2 (preflight). Module 3 (tdd-intent)
in the next cycle will close the trio and lift T to L4.

## Change being made

`tests/test_preflight_properties.py` with ≥ 5 Hypothesis properties on
`orchestrator.preflight.preflight_issue`:

1. **Total function**: for any (title, body, root), it returns a
   `PreflightResult` (never raises).
2. **ok=True implies terminal_status=None**.
3. **ok=False implies non-empty reason**.
4. **Symbol detection is a subset**: `detected_symbols` contains only
   tokens that appear in the input (title+body).
5. **File detection is a subset**: same for `detected_files` /
   `forbidden_files`.
6. **Idempotent re-call**: calling twice with the same inputs returns
   structurally equal results.

## Acceptance criteria
- [ ] `tests/test_preflight_properties.py` exists with ≥ 5
      `@given`-decorated property tests
- [ ] All properties pass at Hypothesis default settings
- [ ] `pytest -q` full suite green; no regression
- [ ] `LEVEL.md` evidence shows "2 of 3 property-based files for L4"
- [ ] `scripts/compute_level.py --check` exits 0

## Files to touch (closed set)
- `tests/test_preflight_properties.py` (new)
- `cycles/20260512-045610/{PLAN,RESULT,REPORT,STATE.before,verify-output}.md`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Forbidden files
- secrets, LEVEL.md hand-edit, production code (`orchestrator/preflight.py`
  is the module under test — not modified, only tested)

## Rollback plan
`git reset --hard autoevo/pre-20260512-045610`

## Risk score
low

## FAILURES.md pre-flight result

Preflight run flagged:
- **FAIL-0002** (impossible-spec preflight) — `preflight` keyword overlap.
  This cycle TESTS the V4 preflight implementation against the documented
  pattern; it does not re-introduce the V3 failure.
- **FAIL-0003** (Guardian phantom-cost) — `billable` keyword overlap from
  "Cycle 4 added 1 (billable)" reference. This cycle is about preflight,
  not billable; the mention is just contextual reference to the
  property-test trio. Not a repeat of FAIL-0003.

## Open questions / blockers
None.
