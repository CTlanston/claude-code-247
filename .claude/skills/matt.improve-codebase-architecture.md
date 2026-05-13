# Skill: matt.improve-codebase-architecture

> A Wave 1 stub. Track K2 (future) will wire this into the
> `orchestrator/skill_router.py` classifier.

## Purpose

Identify a code smell or architectural friction in the codebase
and propose the smallest vertical-slice improvement that
addresses it, with a regression test that locks in the new
contract.

## When to invoke

Trigger this skill when:

- A cycle's PLAN involves a refactor (not feature, not fix)
- A FAILURES.md entry's root cause is architectural (e.g.
  FAIL-0003's "cost masked at read-time for one consumer
  instead of at write-time at the source")
- A reviewer (Claude or Codex or adversarial) flags an
  architectural concern in a recent PR
- A `propose_next_track.py` proposal cites architectural debt

## What this skill does

Four steps, in order:

1. **Name the smell**. Use a recognizable label: god-object,
   leaky abstraction, primitive obsession, feature envy,
   shotgun-surgery, etc. If you can't name it, you don't
   understand it yet.
2. **Draft an ADR**. Even small refactors get an
   `docs/adr/NNNN-<slug>.md` file with: context, decision,
   alternatives considered, consequences. The ADR is the
   contract; the code is the implementation.
3. **Smallest vertical slice**. Pick the minimum change that
   delivers the new contract end-to-end (not all at once across
   the whole codebase). One module deep, one feature wide.
4. **Lock in with a test**. The test asserts the new contract,
   not just the new code. Refactors that don't change observable
   behavior should add tests that pin existing behavior so
   future changes don't drift.

## What this skill does NOT do

- **Does NOT** rewrite working code "for clarity" without a
  measured benefit. The L7 §0 rule 12: "no feature outside the
  rubric."
- **Does NOT** introduce new dependencies. Architectural changes
  should reduce or maintain the dependency surface, not grow it.
- **Does NOT** make multi-module sweeping changes in a single
  cycle. Per §4 step 5, atomic commits with a closed file set.
  If the refactor needs > 1 cycle, split it via matt.to-issues.

## Exit criteria

- A new ADR exists in `docs/adr/`
- The vertical slice is committed atomically
- At least one new test pins the new contract
- `pytest -q` green
- `compute_level.py --check` green
- The smell named in step 1 is observably reduced (subjective,
  but the cycle's REPORT.md should state it)

## Related artifacts

- `AUTODEV_L7_MASTER_PROMPT.md` §0 rule 12 (no rubric-irrelevant
  features)
- `docs/adr/0000-*.md` ... `0008-*.md` (existing ADRs)
- `FAILURES.md` (architectural lessons are often here)
