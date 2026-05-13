# Skill: matt.diagnose

> A Wave 1 stub. Track K2 (future) will wire this into the
> `orchestrator/skill_router.py` classifier.

## Purpose

Investigate and remediate a stuck or repeating failure via the
formal Diagnose flow defined in `AUTODEV_L7_MASTER_PROMPT.md` §7
Diagnose contract + §11 state machine.

## When to invoke

Trigger this skill when ANY of:

- A blocker has recurred ≥ 2 times with the same `blocker_reason`
- CI has failed ≥ 2 times on the same shadow branch
- The Reviewer has rejected ≥ 2 consecutive iterations
- An error signature matches a prior cycle's failure log
- A task has been at the same state for > 1 supervisor cycle with
  no PROGRESS in `reports/state.json`

## What this skill does

Five steps, in order:

1. **Reproduce** — capture the exact failing command, environment,
   inputs. Write to `reports/diagnose-<ts>/reproduction.md`.
2. **Minimize** — strip the failing case to the smallest
   self-contained reproducer.
3. **Hypothesize** — generate exactly 3 candidate root causes,
   ranked by likelihood. Cite evidence from logs + code.
4. **Fix** — implement the highest-ranked fix as a normal §4
   cycle (PLAN → TDD → atomic commit).
5. **Regression test** — every diagnose fix MUST land a regression
   test that fails before the fix and passes after.

## What this skill does NOT do

- **Does NOT** modify production data without a rollback tag.
- **Does NOT** disable any safety gate (Guardian / TDD invariant /
  preflight / intake_sanitizer / action_evaluator) to make a test
  pass. Per §0 rule 6.
- **Does NOT** infinite-loop on transient failures. Caps at 5
  diagnose attempts then writes BLOCKED.md.
- **Does NOT** consult the Codex CLI for opinion unless ADR-0008
  budget allows.

## Exit criteria

- The reproducer passes (was failing, now succeeds), AND
- A regression test is committed, AND
- `FAILURES.md` is updated with the entry (date, symptom, root
  cause, working fix, regression test).

## Related artifacts

- `AUTODEV_L7_MASTER_PROMPT.md` §7 Diagnose contract
- `AUTODEV_L7_MASTER_PROMPT.md` §11 state machine
- `FAILURES.md` (every diagnose adds an entry)
- Future: `orchestrator/diagnose.py` (Track P4)
