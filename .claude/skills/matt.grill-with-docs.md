# Skill: matt.grill-with-docs

> A Wave 1 stub. Track K2 (future) will wire this into the
> `orchestrator/skill_router.py` classifier.

## Purpose

Read-heavy verification mode. When a change touches a contract
(public API, file format, ADR-defined behavior), this skill
cross-checks the change against the canonical doc to catch
silent drift between code and spec.

## When to invoke

Trigger this skill when:

- A cycle's PLAN modifies a file mentioned in an ADR's
  "consequences" section
- A change touches a public function whose docstring is the
  contract
- A cycle adds a new env var, config flag, or CLI option
- A test was deleted or modified in a way that changes what
  the test asserts (not just refactoring how it asserts it)

## What this skill does

Three steps, in order:

1. **Locate the canonical doc**. For each touched file/function,
   identify the source of truth: ADR? README? FAILURES entry?
   master prompt section? If none exists, write one as part of
   this cycle (per the matt.improve-codebase-architecture skill).
2. **Diff the change against the doc**. For each contract
   element the change touches, ask: does the code still match
   what the doc says? If yes, fine. If no, two options:
   - The code is correct; update the doc.
   - The doc is correct; revert the code change and write
     `BLOCKED.md` explaining the contract violation.
3. **Add a regression test** that pins the contract going
   forward. If a function's docstring says "returns positive
   int", add a property test asserting the return is always
   `> 0`.

## What this skill does NOT do

- **Does NOT** rubber-stamp changes that "feel right". The whole
  point is to catch silent drift, which means actually reading
  the docs.
- **Does NOT** invent new contracts mid-cycle. If the existing
  doc is ambiguous, surface the ambiguity to the cycle's PLAN
  and either resolve it via an ADR or escalate.
- **Does NOT** require Codex CLI consultation. The grill is
  evidence-based, not opinion-based.

## Exit criteria

- Every contract element the cycle touched is verified against
  its canonical doc
- Any mismatch is either resolved (one direction or the other)
  or escalated to BLOCKED.md
- A regression test pins the contract for at least one element
  per cycle (typically the most-touched one)

## Related artifacts

- All ADRs in `docs/adr/`
- `AUTODEV_L7_MASTER_PROMPT.md` (its sections ARE contracts)
- `CONTEXT.md` (system invariants — the highest-tier doc)
- `FAILURES.md` (drift between code and spec is a recurring
  failure pattern; this skill prevents future entries)
