# Cycle 20260513-163434 PLAN — Cycle 43 (ADR-0009 emission-not-dirty)

## Target dimension

M (Memory). Adds a 7th ADR (existing 6 + this) so the ADR count
floor M-L5 requires (`>=3`) is now well above threshold. Streak
23→24.

## Specific gap being closed

Across Cycles 33/38/39/40, a coherent design discipline emerged:
"runtime emission of an artifact must NOT cause that artifact to
dirty the tracked tree." The discipline was applied four times:

- Cycle 33: `AUTODEV_AUDIT_LOG_SUPPRESS` env-var gate on the cli
  executor's `_log()` writer
- Cycle 38: doctor reads health.json read-only (does NOT invoke
  the emitter; that's the operator's separate action)
- Cycle 39: `.gitignore` + `git rm --cached` on the 3 health
  regenerated artifacts
- Cycle 40: wake script DOES invoke the emitter, but the
  artifacts are already gitignored from Cycle 39 — the
  combination keeps the tree clean

Each cycle applied the principle in isolation. No canonical
document explains the pattern as a single coherent rule. Future
cycles that hit a similar surface (e.g. when wiring lint, flake
detection, or another emitter) would have to rediscover the
pattern by accident.

ADR-0009 names the pattern, lists the four 2026-05-13 applications
with their respective fix mechanisms, and provides the decision
template future cycles should follow.

## Change being made

1. **`docs/adr/0009-runtime-emission-no-tree-dirty.md`** (new):
   Standard ADR format: Context / Decision / Alternatives
   considered / Consequences / References. The Decision section
   states the rule:

   > When a module / script emits an artifact to disk as part of
   > its normal runtime (logs, score snapshots, history files,
   > etc.), the emission MUST NOT cause `git status --porcelain`
   > to show that artifact as a modified tracked file. Acceptable
   > mechanisms (in preference order):
   >   1. `.gitignore` + `git rm --cached` — the artifact stays
   >      operational-only.
   >   2. Env-var gate on the writer (`AUTODEV_*_SUPPRESS=1`) for
   >      contexts where the file IS tracked but tests must not
   >      mutate it.
   >   3. Read-only consumer pattern — the consumer reads but
   >      does NOT trigger re-emission.

2. **`FAILURES.md` FAIL-0009 entry** — update `**Linked ADR**:`
   field to reference ADR-0009 (it currently has no Linked ADR
   field, which is acceptable per the schema — Linked ADR is
   optional). Adding the link makes the discipline cross-
   navigable.

3. **`tests/test_adr_0009.py`** (new, ~5 tests):
   - ADR file exists at expected path
   - Contains the standard sections (Context / Decision /
     Consequences / References)
   - References all 4 applying cycles (33, 38, 39, 40)
   - Decision section lists the 3 acceptable mechanisms
   - File size > 1 KB (sanity guard against truncation)

4. **Streak via Scheduler API** (now standard, 3rd cycle using it).

## Acceptance criteria

- [x] `docs/adr/0009-runtime-emission-no-tree-dirty.md` exists
- [x] FAIL-0009 entry has `**Linked ADR**: ` line referencing 0009
- [x] `tests/test_adr_0009.py` ≥ 5 tests, all green
- [x] `pytest tests/ -q` green
- [x] `compute_level --check` green (after propose-first)
- [x] M-dim evidence string still cites ≥6 ADRs (was 6; now 7)
- [x] streak 23→24 via Scheduler API

## Files to touch (closed set)

- `docs/adr/0009-runtime-emission-no-tree-dirty.md` (new)
- `FAILURES.md` (FAIL-0009 entry — add Linked ADR line)
- `tests/test_adr_0009.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (note Cycle 43 done)
- `STATE.md` (rewrite)
- `cycles/20260513-163434/PLAN.md` (this)
- `cycles/20260513-163434/REPORT.md`
- `cycles/20260513-163434/RESULT.md`
- `cycles/20260513-163434/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (via Scheduler API)
- `reports/cycle-history.jsonl` (via Scheduler API)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.
- Existing ADRs 0000-0008 (this cycle only adds; doesn't
  modify priors).

## Rollback plan

`git reset --hard autoevo/pre-20260513-163434`.

## Risk score

low. Pure docs (ADR + a small line addition to FAILURES.md) +
structural tests.

## FAILURES.md pre-flight result

Keywords: ADR, emission, tracked, tree, dirty, FAIL-0009.

- **FAIL-0009** matched on `doctor` keyword (via the existing
  Cycle 33 corrected-diagnosis block; the keyword is in that
  entry). **Cited and disambiguated**: This cycle adds an ADR
  about the pattern that FIXED FAIL-0009; it doesn't re-fix
  the original failure. The Linked ADR addition makes the
  cross-reference explicit. Different layer (docs, not code).
- No other FAILURES.md matches.

## Open questions / blockers

None.
