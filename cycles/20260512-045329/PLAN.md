# Cycle 20260512-045329 PLAN — Track T2-property-billable

## Target dimension
T (Test oracle)

## Specific gap being closed
Per L7 §9: T-dim L4 requires property-based tests (Hypothesis) on >= 3
modules. Today we have 0. This cycle adds property tests for
`orchestrator.billable` — the first of three.

## Change being made

1. Install `hypothesis` (already done via `pip3 install --user`).
   Document in a new `requirements-dev.txt` for reproducibility.
2. Add `tests/test_billable_properties.py` with >= 3 Hypothesis
   properties:
   - `is_subscription_mode(env)` is a pure function — same input always
     produces same output (idempotent on the env dict)
   - `to_billable_cost(...)` always returns >= 0 (no negative billing)
   - subscription mode forces output = 0 regardless of raw cost or
     token counts
3. Also include 1-2 stateful properties: e.g. for any (raw, in_tok,
   out_tok) tuple, the API-mode result <= the raw input (after zero-
   token clamp), so the helper never *inflates* cost.

## Acceptance criteria
- [ ] `tests/test_billable_properties.py` exists with >= 3 `@given(...)`-
      decorated property functions
- [ ] All property tests pass with default Hypothesis settings
      (max_examples=100 baseline, no `derandomize` flag)
- [ ] `pytest -q tests/test_billable_properties.py` runs cleanly
- [ ] `pytest -q` full suite green; no regression
- [ ] `requirements-dev.txt` exists listing `hypothesis`
- [ ] `scripts/compute_level.py` keeps `T = 3` for now (need 3 property
      modules for L4) but reports the new property file in evidence
- [ ] `scripts/compute_level.py --check` doesn't regress any dim

## Files to touch (closed set)
- `tests/test_billable_properties.py` (new)
- `requirements-dev.txt` (new)
- `cycles/20260512-045329/PLAN.md` (this)
- `cycles/20260512-045329/RESULT.md`
- `cycles/20260512-045329/REPORT.md`
- `cycles/20260512-045329/STATE.before.md` (snapshot)
- `cycles/20260512-045329/verify-output.txt`
- `cycles/20260512-045329/next-track-proposal.json` (already written
  by `propose_next_track.py --for-cycle`)
- `BACKLOG.md` (mark T2-billable progress; add T2-preflight + T2-tdd-intent as next P0)
- `STATE.md` (rewrite)
- `CHANGELOG.md` (append)
- `LEVEL.md` (regenerate)

## Files forbidden to touch
- `.env*`, `secrets/**`, `*.key`, etc.
- `LEVEL.md` by hand
- `orchestrator/billable.py` (production module is frozen baseline;
  we only TEST it)
- existing tests

## Rollback plan
`git reset --hard autoevo/pre-20260512-045329`

## Risk score
low — additive test file + a dev-dep manifest. No production code.

## FAILURES.md pre-flight result

Run after writing this section. Expected matches: possibly FAIL-0003
("billable", "phantom_cost", "subscription") since the tests target
`to_billable_cost`.
