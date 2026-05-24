# Cycle 20260512-050827 PLAN — Track S3 (intake sanitizer)

## Target dim
S (Safety)

## Specific gap being closed
S-dim L6 requires the 4th safety gate (after Guardian + TDD + preflight):
intake sanitizer that strips/flags prompt-injection patterns in issue
bodies and comments.

## Change being made

1. `orchestrator/intake_sanitizer.py` (new):
   - `sanitize_issue(title: str, body: str) -> SanitizationResult`
     where `SanitizationResult` has `clean_title`, `clean_body`,
     `flagged_spans: List[FlaggedSpan]`, `risk_score: int (0-100)`
   - Detect patterns:
     - "ignore previous instructions" / "ignore all previous"
     - "please approve" / "you must approve" / "auto-approve"
     - "as the reviewer" / "as a code reviewer" (impersonation)
     - "system:" or "## system" embeds (role-confusion)
     - Hidden Unicode tag characters (U+E0000–U+E007F)
     - URLs of the form `javascript:` / `data:` / `file://`
     - Backtick-quoted commands matching `rm -rf` / `curl ... | sh`
     - "the answer is" / "the correct fix is" / "trust this"
   - Sanitize approach: REDACT spans (replace with `[REDACTED:reason]`)
     in clean_title/clean_body; preserve original text in flagged_spans
   - Conservative: never alter benign content; over-flag is the design

2. `tests/test_intake_sanitizer.py` (new, ≥ 8 tests)

3. Update `scripts/compute_level.py` if needed (the existing
   KNOWN_GATES entry for "intake_sanitizer" should already detect this
   once the module + test exist — verify after writing).

## Acceptance criteria
- [ ] `orchestrator/intake_sanitizer.py` exists with `sanitize_issue`
- [ ] `tests/test_intake_sanitizer.py` has ≥ 8 tests, all green
- [ ] `pytest -q` full suite green; no regression
- [ ] `LEVEL.md` reports `S = 6` (gate count: 4)
- [ ] `compute_level --check` exits 0

## Files (closed set)
- `orchestrator/intake_sanitizer.py` (new)
- `tests/test_intake_sanitizer.py` (new)
- `cycles/20260512-050827/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Forbidden
- secrets, hand-edit LEVEL.md, other production code
- Existing tests / roles / ADRs

## Rollback
`git reset --hard autoevo/pre-20260512-050827`

## Risk score
low

## FAILURES.md pre-flight

Preflight flagged three matches via PLAN keyword overlap (the PLAN
contains "reviewer", "tdd", "preflight", "guardian" because it mentions
the existing safety gates by name). Citations:

- **FAIL-0001** (Reviewer over-strict on TDD) — keywords reviewer/tdd
  matched because the PLAN lists existing gates including the TDD
  invariant. Not re-introducing the V3 #14 pattern.
- **FAIL-0002** (Impossible spec preflight) — keyword preflight matched
  because the PLAN lists preflight as an existing gate. Not touching
  preflight.py.
- **FAIL-0003** (Guardian phantom-cost) — keyword guardian matched
  because the PLAN lists Guardian as an existing gate. Not touching
  Guardian's cost logic.

In all three: this cycle ADDS a sibling gate (sanitizer); it doesn't
modify any of the cited gates.

## Open questions
None.
