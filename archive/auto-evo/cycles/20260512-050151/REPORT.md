# Cycle 20260512-050151 Report — Track R2 (codex bridge, gated)

## Verdict
PASS — Codex bridge infrastructure built honestly. R stays at L3 because
the Codex CLI is not currently on PATH. When the user installs Codex,
R auto-promotes to L5 on the next `compute_level.py` run.

## Level changes
No dim moved. R-dim was the target but is gated on an external dep.

## Change

1. `orchestrator/codex_reviewer.py` — new module:
   - `codex_available()` (probes `shutil.which`)
   - `run_codex_review(diff, prompt_path, timeout)` — shells out to
     Codex CLI; returns `CodexVerdict(available, verdict, raw_output, error)`
   - When Codex absent: returns immediately with verdict="codex_unavailable",
     no subprocess invocation, no risk of paid spend
   - Strict timeout, FileNotFoundError handling for races, non-zero
     exit treated as error not verdict
   - `disagreement_protocol(claude_v, codex_v)` — returns reason string
     when PASS/FAIL disagree, None otherwise; codex_unavailable is never
     a disagreement
   - `write_alert(reason, alert_path)` — appends timestamped block to
     ALERT.md

2. `tests/test_codex_reviewer.py` — 12 mock-based tests covering
   availability detection, subprocess invocation, error/timeout paths,
   disagreement protocol semantics, and ALERT.md emission.

3. `scripts/compute_level.py` — `_gate_is_active` now honors a
   `require_binary_on_path` field on gate config. The codex bridge
   gate sets this to "codex". L5 only fires when BOTH the bridge code
   AND `shutil.which("codex")` succeed. Evidence string for R-dim now
   surfaces "bridge code in place but codex CLI not on PATH" when the
   binary is missing — informative for the operator.

4. `tests/test_compute_level.py` — 26 tests now (added 1):
   - `test_review_l5_when_codex_active` patched to mock `shutil.which`
   - `test_review_stays_l3_when_codex_artifacts_present_but_binary_missing`
     (new) — locks in the honesty check

## Why R didn't move to L5 this cycle

By design. The L7 master prompt §0 + §16 forbid soft-cheating the
rubric: claiming a level on disk that isn't backed by real evidence is
exactly what the "Never hand-edit LEVEL.md" rule guards against. The
compute_level update enforces the same discipline programmatically.

The bridge is "armed not fired". When the user does
`brew install codex` (or whatever their channel is), the next
compute_level run will:
- detect `codex` on PATH
- find the bridge module + test
- promote R from L3 to L5

No code change needed at that point.

## Files modified
```
orchestrator/codex_reviewer.py     (new)
tests/test_codex_reviewer.py       (new, 12 tests)
scripts/compute_level.py           (require_binary_on_path field + check)
tests/test_compute_level.py        (mock shutil.which + 1 new negative test)
CHANGELOG.md
BACKLOG.md                          (R2 → DONE; next P0 = M3)
STATE.md
LEVEL.md                            (R evidence updated; still L3)
cycles/20260512-050151/*
```

## Verify
- pytest: 195 passed, 1 skipped, 0 failed
- compute_level --check: passed (no regression)
- doctor: 11/0/2

## Next track
Per propose_next_track: **Track M3** (failure-clustering script).
Cheapest move from M-L5 → M-L6.

## Wall clock
~12 minutes.
