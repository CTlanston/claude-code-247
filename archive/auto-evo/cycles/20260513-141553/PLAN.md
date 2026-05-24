# Cycle 20260513-141553 PLAN — Cycle 34 (Track S5: adversarial return-check)

## Target dimension

S (Safety gates). S is already at L7 max so no rubric move, but
this adds a real safety gate: the adversarial subagent's return
contract is now validated against a known-category whitelist.
Streak-bump only.

## Specific gap being closed

`orchestrator/adversarial_reviewer.py:run_adversarial_review()`
already validates the `verdict` field against a 6-value whitelist
(line 84-86). But it does NOT validate `finding.category` — the
loop at line 88-97 trusts whatever the subagent emits and stuffs
it into the dataclass field. The role-prompt schema (docstring
line 38) declares 10 valid categories:

  race | trust | silent_loss | leak | n_plus_1 |
  auth | incompat | idempotency | toctou | boundary

If the subagent drifts (prompt update, model change) or is
prompt-injected, unknown categories silently propagate into
downstream consumers. Track S5 fixes that.

## Change being made

1. **`orchestrator/adversarial_reviewer.py`**:
   - Add `_KNOWN_FINDING_CATEGORIES: frozenset[str]` module-level
     constant with the 10 documented categories + "other" as
     the canonical fallback.
   - In `run_adversarial_review`'s findings-build loop: if the
     parsed category is not in `_KNOWN_FINDING_CATEGORIES`,
     remap to "other". This is silent normalization — no crash,
     no warning to stderr (the existing module's exception
     swallow pattern at line 73-75 is "never raise"; we match it).
   - Add public function
     `validate_adversarial_review_contract(review: AdversarialReview) -> list[str]`
     returning a list of contract-violation strings (empty if
     valid). Checks:
     - `verdict` is one of the 6 documented values
     - every `findings[i].category` is in
       `_KNOWN_FINDING_CATEGORIES`
     - every finding has a non-empty `message`
     - `source == "adversarial"`
   - Add module-level constant
     `KNOWN_FINDING_CATEGORIES: tuple[str, ...]` exported as
     the public name (test imports it, future callers can
     introspect).

2. **`tests/test_adversarial_return_check.py`** (new):
   Pytest tests covering:
   - The constant exposes all 10 documented categories + "other"
   - `run_adversarial_review` normalizes unknown categories to
     "other" (with a fake runner.run_role returning a finding
     with `category="cosmic_rays"`)
   - Known categories pass through unchanged
   - `validate_adversarial_review_contract` returns [] for a
     valid review
   - returns >=1 violation for: bad verdict, unknown category,
     empty message, wrong source
   - public `KNOWN_FINDING_CATEGORIES` is a tuple (immutable),
     not a list

## Acceptance criteria

- [x] `_KNOWN_FINDING_CATEGORIES` whitelist in module
- [x] Unknown categories silently remapped to "other"
- [x] Public `validate_adversarial_review_contract` returns
      `list[str]` of violations
- [x] `tests/test_adversarial_return_check.py` ≥ 8 tests
- [x] All existing `tests/test_adversarial_reviewer.py` tests
      still pass (no regression)
- [x] `pytest tests/ -q` green
- [x] `compute_level --check` green (after propose-first)
- [x] `autodev_doctor.sh`: 13/0/2

## Files to touch (closed set)

- `orchestrator/adversarial_reviewer.py` (~25-line add)
- `tests/test_adversarial_return_check.py` (new)
- `CHANGELOG.md` (one line)
- `BACKLOG.md` (mark S5 done)
- `STATE.md` (rewrite)
- `cycles/20260513-141553/PLAN.md` (this)
- `cycles/20260513-141553/REPORT.md`
- `cycles/20260513-141553/RESULT.md`
- `cycles/20260513-141553/next-track-proposal.json`
- `reports/zero-deadlock-streak.txt` (14→15)
- `reports/cycle-history.jsonl` (append)

## Files forbidden to touch

- `.env*`, `secrets/**`, `LEVEL.md`, anything in §0.
- `runner/roles/adversarial_reviewer.md` — the role prompt is
  the canonical schema; the Python contract validator MUST
  align with it, not the other way around.

## Rollback plan

`git reset --hard autoevo/pre-20260513-141553`.

## Risk score

low. Defensive normalization + a pure validator helper. No call
sites change behavior; unknown categories go from "stored as-is"
to "stored as 'other'", which is strictly safer.

## FAILURES.md pre-flight result

Keywords: adversarial, subagent, return, contract, validate,
category, finding, whitelist, idempotency (as one of the 10
documented finding categories).

- **FAIL-0007** matched on `idempotency`. **Cited and
  disambiguated**: FAIL-0007 is about SQL idempotency on
  `record_run` (`INSERT OR IGNORE` migration not yet shipped).
  This cycle's use of "idempotency" is one of the 10
  documented categories in the adversarial reviewer's role
  prompt that an `AdversarialFinding.category` may take. This
  cycle adds a whitelist that ACCEPTS "idempotency" as a valid
  category — it does NOT touch `orchestrator/db.py`, the SQL
  schema, or the record_run code path. Different system,
  different layer; not a repeat.
- No other FAILURES.md matches.

## Open questions / blockers

None.
