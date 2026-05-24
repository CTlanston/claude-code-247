# Cycle 20260512-043811 PLAN — Track M2 (FAILURES preflight)

## Target dimension
M (Memory)

## Specific gap being closed
Per §3 rubric: M-L5 requires "FAILURES.md ≥ 10 entries AND grep-injected
into every PLAN". The grep step doesn't exist yet — there's no script that
takes a PLAN.md, extracts keywords, and reports FAILURES.md matches. Per
`scripts/compute_level.py::memory_dim`, M is currently capped at L4
specifically because `scripts/preflight_failures.py` is absent (and
FAILURES.md is at 4 entries, below the 10 threshold).

## Change being made

Build `scripts/preflight_failures.py`:
- Input: a PLAN.md path (or stdin)
- Extract keywords from "Change being made" + "Files to touch" + "FAILURES.md pre-flight result" sections
- Grep `FAILURES.md` for keyword matches (case-insensitive, allowing
  hyphens/underscores variation, with a simple scoring rule)
- Emit machine-readable JSON listing matched entries with (id, keyword, score, headline)
- Exit code 0 if no matches; 1 if at least one match (treat as a soft
  warning the operator must explicitly address)
- A `--strict` mode that exits 1 if any matches AND PLAN doesn't contain
  the string "FAIL-NNNN" referencing each match (forcing the planner to
  cite why this time is different)

Then add a single regression test file `tests/test_preflight_failures.py`.

This cycle does NOT yet wire the script into the L7 PLAN protocol — that's
a separate cycle (Track M2.5 if it's worth a dedicated cycle, otherwise
folded into M3). One cycle = one disciplined increment.

## Acceptance criteria
- [ ] `scripts/preflight_failures.py` exists and is executable
- [ ] `tests/test_preflight_failures.py` has ≥ 8 tests covering:
      keyword extraction, FAILURES.md parsing, match scoring,
      no-match case, --strict mode, JSON output, missing-file handling,
      and an end-to-end integration test using the real `FAILURES.md`
- [ ] `pytest -q` green; no existing test regresses
- [ ] `scripts/compute_level.py --check` exits 0 (no regression in any dim)
- [ ] M-dim level reported by compute_level still 4 (the script alone
      doesn't lift to L5 — that requires 10+ FAILURES entries also)
- [ ] `./scripts/autodev_doctor.sh` exits 0 (warns allowed)
- [ ] All commits use Conventional Commits format
- [ ] TDD intent: at least one `test:` commit before the first `feat:` /
      `impl:` commit on this branch

## Files to touch (closed set)
- `scripts/preflight_failures.py` (new)
- `tests/test_preflight_failures.py` (new)
- `cycles/20260512-043811/PLAN.md` (this file)
- `cycles/20260512-043811/RESULT.md` (new)
- `cycles/20260512-043811/REPORT.md` (new)
- `cycles/20260512-043811/STATE.before.md` (new — snapshot)
- `cycles/20260512-043811/verify-output.txt` (new)
- `BACKLOG.md` (mark Track M2 progress / DONE)
- `STATE.md` (rewrite per §5 schema)
- `CHANGELOG.md` (append cycle line)
- `LEVEL.md` (regenerate via compute_level.py)

## Files forbidden to touch
- `.env*`, `secrets/**`, `*.key`, `*.pem`, `id_rsa*`
- `LEVEL.md` by hand (regenerate ONLY via compute_level.py)
- `orchestrator/**/*.py`, `autodev/**/*.py`, `runner/**` (production code is
  frozen this cycle — pure tooling addition)
- `CONTEXT.md` (would require ADR; not needed for this cycle)
- existing ADRs / FAILURES.md (append-only; not touched)
- existing tests (only `test_preflight_failures.py` is new)

## Rollback plan
`git reset --hard autoevo/pre-20260512-043811`

## Risk score
low — pure tooling addition. No production code touched. Worst case:
script has a bug, tests catch it; if VERIFY fails, rollback and re-plan.

## FAILURES.md pre-flight result

Greppable keywords for this cycle: preflight, failures, grep, script,
keyword-extract, json-output, planner-injection.

Grepping `FAILURES.md` manually:
- FAIL-0002 has keyword "preflight" — but that's the *issue-level* preflight
  (impossible-spec detection from V3 #15), not the PLAN-level preflight
  this cycle is building. Different layer.
- Other FAIL entries don't match.

No clashes. Proceeding.

## Open questions / blockers
None.
