# Cycle 20260513-050612 Report — Phase B Cycle 25 (wake script)

## Verdict
PASS — infrastructure cycle. `scripts/autodev_continuous_cycle.sh`
is the launchd wake script that will fire every 15 minutes after the
operator installs the plist. No dim level move expected (and none
happened); the deliverable is the script + 15-test regression suite.

## Level changes
None. C streak bumped 5→6 (no deadlock observed).

## Change

1. **`scripts/autodev_continuous_cycle.sh`** (new, executable, ~140 lines):
   The wake script. Transcribes the kickoff doc's bash spec with
   these adjustments:
   - `AUTODEV_REPO_ROOT` env var (defaults to script's parent of parent).
     Lets tests point it at a tmp dir without `cd` side effects.
   - `AUTODEV_CLAUDE_BIN` env var (default `claude`). Tests stub it.
   - `AUTODEV_TIMEOUT_BIN` env var (default empty). Auto-detects
     `timeout` or `gtimeout`. Falls back gracefully if neither is on
     PATH (logs a warning, skips the timeout wrap).
   - macOS / Linux compatibility for `stat`: tries `stat -f %m` first
     (BSD), falls back to `stat -c %Y` (GNU).
   - Always exits 0 (so launchd doesn't enter ThrottleInterval, which
     would lock dispatch out for hours).

   Stop conditions honored:
   - `reports/AUTODEV_DONE.md` exists → exit 0
   - `reports/STOPSWITCH` exists → exit 0
   - `BLOCKED.md` exists < 24h old → exit 0
   - `reports/health.json` score < 50 → exit 0
   - Cooldown: last_wake.ts < 300s ago → exit 0
   - Rate-limit until-ts in the future → exit 0
   - LEVEL.md says Overall L >= AUTODEV_TARGET_L (default 5) →
     write AUTODEV_DONE.md, exit 0

   Rate-limit detection: after the `claude -p` invocation, grep the
   cycle log for `rate.?limit|429|too many requests` (case-insensitive).
   If matched, write `reports/quota-rate-limit-until.ts` with the
   epoch ts of now + AUTODEV_BACKOFF_S (default 3600).

2. **`tests/test_autodev_continuous_cycle.py`** (new, 15 tests):
   - Existence + executable (2)
   - Each stop condition (5): AUTODEV_DONE, STOPSWITCH, BLOCKED < 24h,
     health < 50, target-L reached writes AUTODEV_DONE.md
   - Cooldown (2): under 5 min skips, over 5 min proceeds
   - Rate-limit (2): active window skips, expired window cleans up
   - Normal dispatch (2): claude invoked, last_wake.ts updated
   - Rate-limit detected in log → backoff stamp written
   - Always exits 0 even when claude returns non-zero

## Procedural lesson (encoded in Cycle 26 prompt)

During VERIFY, `compute_level --check` initially flagged a false
regression: E-dim 7 → 4. Root cause: E-L5 detection looks at the last
5 cycle folders for `next-track-proposal.json`. At the moment
`--check` runs in RECORD, the current cycle's folder exists but the
proposal artifact hasn't been written yet (we hadn't run
`propose_next_track --for-cycle <id>` yet) → 4/5 ratio → E drops.

The fix is procedural: **always run `propose_next_track --for-cycle
<id>` BEFORE `compute_level --check` during RECORD.** This will be
encoded in `scripts/autodev_cycle_prompt.md` next cycle so the
launchd-driven path doesn't repeat the false alarm.

## Files modified
```
scripts/autodev_continuous_cycle.sh             (new, executable)
tests/test_autodev_continuous_cycle.py          (new, 15 tests)
CHANGELOG.md, BACKLOG.md, STATE.md, LEVEL.md
reports/zero-deadlock-streak.txt                (5→6)
reports/cycle-history.jsonl                     (+ entry)
cycles/20260513-050612/*
```

## Verify
- pytest: 385 passed, 2 skipped, 0 failed
- compute_level --check (post-proposal): passed
- doctor: 12/0/2
- streak: 6/30 → 24 more disciplined cycles needed for C-L5

## Constraints honored

- No `git push`. No PR merge. No secret touch. (None applicable to
  this cycle.)
- The wake script does NOT auto-install launchd. Cycle 27 builds
  the installer separately; Cycle 29 smoke-tests in foreground; the
  operator runs `--install` exactly once after Phase B is done.
- 45-min budget: ~15 minutes for this cycle.

## Next
**Phase B Cycle 26**: `scripts/autodev_cycle_prompt.md`.

## Wall clock
~15 minutes.
