# Cycle 20260513-050612 PLAN — Phase B Cycle 25 (continuous wake script)

## Target dimension
None directly — infrastructure cycle. Phase B of
AUTODEV_L7_CONTINUOUS_RUN.md. No dim level move expected; the
launchd-handoff infrastructure is the deliverable.

## Specific gap being closed

Per AUTODEV_L7_CONTINUOUS_RUN.md Phase B Cycle 25: build
`scripts/autodev_continuous_cycle.sh` — the wake script that launchd
will invoke every 15 minutes (StartInterval). The script:

1. Honors all stop conditions: `reports/AUTODEV_DONE.md`,
   `reports/STOPSWITCH`, `BLOCKED.md` (>24h old), `health<50`.
2. Cooldown: refuses double-fire within 5 minutes.
3. Rate-limit awareness: respects `reports/quota-rate-limit-until.ts`.
4. Termination check: writes `reports/AUTODEV_DONE.md` when
   Overall L ≥ `AUTODEV_TARGET_L` (default 5).
5. Runs ONE cycle via `claude -p` with 45-min hard timeout.
6. Always exits 0 so launchd doesn't enter ThrottleInterval.

## Change being made

1. **`scripts/autodev_continuous_cycle.sh`** (new, executable):
   transcription of the kickoff doc's bash, with these adjustments
   for testability:
   - `AUTODEV_REPO_ROOT` env override (default: parent of script dir).
     So tests can point it at a tmp dir without `cd` side effects.
   - `AUTODEV_CLAUDE_BIN` env override (default `claude`). Tests
     replace it with a stub that just records its invocation.
   - `AUTODEV_TIMEOUT_BIN` env override (default `timeout`). On
     macOS BSD timeout might not be on PATH (`gtimeout` from coreutils
     is). Allow override + fall back gracefully.
   - All log writes use the configured root.

2. **`tests/test_autodev_continuous_cycle.py`** (new, ≥ 8 tests):
   covers each stop condition + cooldown + rate-limit + target-L
   completion + claude-bin substitution.

## Acceptance criteria
- [ ] `scripts/autodev_continuous_cycle.sh` exists + executable
- [ ] `tests/test_autodev_continuous_cycle.py` ≥ 8 tests, all green
- [ ] `pytest -q` full suite green; no regression
- [ ] `compute_level --check` exits 0 (no level move expected)
- [ ] Script honors all kickoff-doc stop conditions
- [ ] Script always exits 0 (no spurious launchd throttle)
- [ ] CHANGELOG, STATE updated

## Files to touch (closed set)
- `scripts/autodev_continuous_cycle.sh` (new, executable)
- `tests/test_autodev_continuous_cycle.py` (new)
- `cycles/20260513-050612/*`
- `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`, `LEVEL.md`

## Files forbidden to touch
- secrets, LEVEL by hand
- production code (orchestrator/, autodev/, runner/)
- existing tests / role prompts

## Rollback plan
`git reset --hard autoevo/pre-20260513-050612`

## Risk score
low — additive shell script + tests. The script itself is never
invoked outside tests in this cycle (DO NOT auto-install launchd).

## FAILURES.md pre-flight result

Preflight flagged FAIL-0004 (macOS /state read-only crash) via `macos`
keyword. This PLAN mentions macOS in the context of "BSD `timeout`
might not be on PATH on macOS (`gtimeout` from coreutils is); allow
env override". That's a defensive compatibility concern, not a
re-introduction of the /state hardcoded-path bug. **Not a repeat of
FAIL-0004**; different code path (a NEW shell script vs. the
supervisor's pending-work DB resolution).
